/**
 * Webdispečink Fleet — backend_provider plugin.
 *
 * Webdispečink moved under Eurowag, but the successor's REST API does not carry
 * everything this one does. Measured against the same tenant on 2026-07-26:
 * this endpoint returns 14 vehicles where Eurowag returns 6, and its driver list
 * carries the Dallas chip, personnel number, division and assigned plate that the
 * successor omits. So the two are kept side by side and neither is authoritative —
 * they observe the same fleet through different windows.
 *
 * It is a PLUGIN rather than core for the reason every vendor integration should
 * be: a deployment that has nothing to do with Webdispečink should not carry the
 * SOAP client, the outbound allowlist, or the credentials. As a workspace service
 * it was optional at deploy time yet mandatory at install time — `npm ci` had to
 * resolve it for everyone, and when the lock file drifted, it broke every CI job
 * including those of deployments that will never call this vendor.
 *
 * Direction: this reads the vendor and writes onto the RAW signal lane. It derives
 * nothing — deciding that a sequence of positions means "a shift happened" belongs
 * one layer up, to the evaluator.
 *
 * Everything reaches the outside world through ctx.fetch, so the sandbox's network
 * allowlist (see manifest) is the real boundary — this module cannot widen it.
 *
 * @module
 */
import { createWdClient, type WdCredentials } from './wd-client.js';
import {
  mapCarItem,
  mapDriverItem,
  mapPositionItem,
  mapRideItem,
  mapWorktimeItem,
  mapOverspeedItem,
  mapDriverStatItem,
  dedupeById,
} from './mappers.js';

const KV_LAST_POSITION_POLL = 'webdispecink:last-position-poll';
const KV_LAST_FLEET_SYNC = 'webdispecink:last-fleet-sync';
const KV_LAST_RIDE_SYNC = 'webdispecink:last-ride-sync';
const KV_LAST_WORKTIME_SYNC = 'webdispecink:last-worktime-sync';
const KV_LAST_OVERSPEED_SYNC = 'webdispecink:last-overspeed-sync';
const KV_LAST_DRIVERSTATS_SYNC = 'webdispecink:last-driverstats-sync';

const DEFAULT_URL = 'https://api.webdispecink.cz/code/WebDispecinkServiceNet.php';
const TIMEOUT_MS = 20_000;

/** Whatever the sandbox hands a plugin — narrowed to what this one actually uses. */
interface Ctx {
  plugin: { version: string };
  tenant: { id: string };
  config: Record<string, unknown>;
  log(level: string, msg: string, meta?: Record<string, unknown>): void;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  kv: { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void> };
  rpc(fn: string, args?: Record<string, unknown>): Promise<unknown>;
  /**
   * Deklarace rozvrhu: host v daném cronu spustí `capability` z manifestu.
   * ⛔ 2026-09-16: dřív `schedule(cron, fn)` — callback nikdo nikdy nevolal a host
   * nevěděl, KTEROU capability spustit (mapování podle pořadí by u eurowag
   * spustilo špatnou synchronizaci).
   */
  schedule(cron: string, capability: string): void;
}

function str(ctx: Ctx, key: string, fallback = ''): string {
  const v = ctx.config[key];
  return typeof v === 'string' ? v : fallback;
}

function num(ctx: Ctx, key: string, fallback: number): number {
  const v = ctx.config[key];
  return typeof v === 'number' ? v : fallback;
}

function bool(ctx: Ctx, key: string, fallback: boolean): boolean {
  const v = ctx.config[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Slušnost k cizímu produkčnímu systému — ne naše throttlování. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function credsFor(ctx: Ctx): WdCredentials {
  return { kodf: str(ctx, 'kodf'), username: str(ctx, 'username'), pass: str(ctx, 'password') };
}

function clientFor(ctx: Ctx) {
  return createWdClient({
    url: str(ctx, 'url', DEFAULT_URL),
    timeoutMs: TIMEOUT_MS,
    fetchImpl: (url, init) => ctx.fetch(url, init),
  });
}

/**
 * The vendor's own field names are kept, because they are the vendor's truth and
 * renaming them here would quietly invent a second vocabulary. Only the shape is
 * settled: numbers stay numbers, blanks become null rather than empty strings, so
 * "no driver assigned" cannot read as a driver named "".
 */
function blankToNull(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v === '' ? null : v;
  return out;
}

export async function init(ctx: Ctx): Promise<void> {
  ctx.log('info', 'webdispecink-fleet initializing', {
    version: ctx.plugin.version,
    tenant: ctx.tenant.id,
  });

  // Cron granularity is a minute; a sub-minute poll would spend calls the API has
  // nothing new to answer with.
  const everyMinutes = Math.max(1, Math.round(num(ctx, 'positionPollSeconds', 300) / 60));
  ctx.schedule(`*/${everyMinutes} * * * *`, 'cron.poll_positions');

  const fleetCron = str(ctx, 'fleetSyncCron', '0 3 * * *');
  ctx.schedule(fleetCron, 'cron.sync_fleet');

  // Jízdy až PO flotile: pracovní seznam pro knihu jízd je registr vozidel,
  // takže sync jízd nad prázdným registrem by neměl co číst.
  const rideCron = str(ctx, 'rideSyncCron', '40 3 * * *');
  ctx.schedule(rideCron, 'cron.sync_rides');

  // Výkony řidičů podle tachografu — per řidič, denní tacho záznamy. Po jízdách.
  const worktimeCron = str(ctx, 'worktimeSyncCron', '50 3 * * *');
  ctx.schedule(worktimeCron, 'cron.sync_worktime');

  // Překročení rychlosti (per vůz) + statistika řidičů (fleet-wide, jedno volání).
  const overspeedCron = str(ctx, 'overspeedSyncCron', '55 3 * * *');
  ctx.schedule(overspeedCron, 'cron.sync_overspeed');
  const driverStatsCron = str(ctx, 'driverStatsSyncCron', '5 4 * * *');
  ctx.schedule(driverStatsCron, 'cron.sync_driver_stats');

  ctx.log('info', 'webdispecink-fleet ready', { pollEveryMinutes: everyMinutes, fleetCron, rideCron, worktimeCron, overspeedCron, driverStatsCron });
}

export async function handle(ctx: Ctx, capability: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (capability) {
    case 'http.GET./cars':
      return { rows: await readCars(ctx) };
    case 'http.GET./drivers':
      return { rows: await readDrivers(ctx) };
    case 'http.GET./positions':
      return { rows: await readPositions(ctx) };
    case 'http.GET./logbook':
      return { rows: await readLogBook(ctx, args) };
    case 'cron.poll_positions':
      await pollPositions(ctx);
      return { ok: true };
    case 'cron.sync_fleet':
      return await syncFleet(ctx);
    case 'cron.sync_rides':
      return await syncRides(ctx);
    case 'cron.sync_worktime':
      return await syncWorktime(ctx);
    case 'cron.sync_overspeed':
      return await syncOverspeed(ctx);
    case 'cron.sync_driver_stats':
      return await syncDriverStats(ctx);
    default:
      ctx.log('warn', 'unknown capability requested', { capability });
      return { error: 'unknown_capability', capability };
  }
}

export async function dispose(ctx: Ctx): Promise<void> {
  ctx.log('info', 'webdispecink-fleet disposing', { tenant: ctx.tenant.id });
}

async function readCars(ctx: Ctx) {
  return (await clientFor(ctx).getCarsList(credsFor(ctx))).map(blankToNull);
}

/**
 * The vendor's `disabled` argument selects ONE group, it does not widen the result:
 * measured live on 2026-07-26, `disabled=0` returns the 15 active drivers and
 * `disabled=1` the 32 inactive ones — 47 together, and no single call returns all.
 *
 * The service this plugin replaces defaulted to `disabled=1` under the name
 * "includeDisabled", so it synced only the inactive drivers and silently missed
 * every active one. Getting the whole roster means asking twice.
 */
async function readDrivers(ctx: Ctx) {
  const client = clientFor(ctx);
  const creds = credsFor(ctx);
  const active = await client.getDriversList(creds, 0);
  if (!bool(ctx, 'includeDisabledDrivers', true)) return active.map(blankToNull);

  const inactive = await client.getDriversList(creds, 1);
  // Dedupe on iddriver: the groups are disjoint today, but a driver reactivated
  // between the two calls would otherwise appear twice.
  const seen = new Set<string>();
  return [...active, ...inactive]
    .filter((r) => {
      const id = String(r.iddriver ?? '');
      if (!id || seen.has(id)) return !id;
      seen.add(id);
      return true;
    })
    .map(blankToNull);
}

async function readPositions(ctx: Ctx) {
  const geocode = bool(ctx, 'geocodePositions', false);
  return (await clientFor(ctx).getAllCarsPositions(credsFor(ctx), geocode)).map(blankToNull);
}

/**
 * The log book is per vehicle and per window, so it is pulled on demand rather
 * than scheduled: there is no "all of it" call, and guessing a window for every
 * vehicle every few minutes would spend the quota on data nobody asked for.
 */
async function readLogBook(ctx: Ctx, args?: Record<string, unknown>) {
  const carId = Number(args?.carId);
  const from = typeof args?.from === 'string' ? args.from : '';
  const to = typeof args?.to === 'string' ? args.to : '';
  if (!Number.isFinite(carId) || carId <= 0 || !from || !to) {
    // Refusing beats guessing a window: a silently-defaulted range would look like
    // a real answer while describing a period nobody asked about.
    throw new Error('WD_LOGBOOK_ARGS: carId, from and to are required (from/to as "YYYY-MM-DD HH:mm:ss")');
  }
  return (await clientFor(ctx).getCarLogBook(credsFor(ctx), carId, from, to)).map(blankToNull);
}

async function pollPositions(ctx: Ctx): Promise<void> {
  try {
    const rows = await readPositions(ctx);
    const positions = rows.map(mapPositionItem).filter(Boolean);
    if (positions.length) await ctx.rpc('wd_upsert_positions_audited', { p_positions: positions });
    await ctx.kv.set(KV_LAST_POSITION_POLL, new Date().toISOString());
    ctx.log('info', 'webdispecink positions polled', {
      read: rows.length,
      stored: positions.length,
    });
  } catch (err) {
    // A vendor outage must not take the plugin host down with it; the next tick retries.
    ctx.log('error', 'webdispecink position poll failed', { error: String(err) });
  }
}

/**
 * Číselník vozidel a řidičů → registr (wd_upsert_*), pak NÁVRHY vazeb identity
 * (wd_propose_identity — nic nezakládá, potvrzuje člověk).
 *
 * ⛔ 2026-09-27: dřív tu byl catch, který selhání jen zalogoval a vrátil se
 * normálně — běh se tak zapsal jako zdravý (register_plugin_event 'invoke')
 * a blok stavu zdrojů vadu nikdy neukázal. Selhání teď běh ukončí chybou.
 */
async function syncFleet(ctx: Ctx): Promise<{ carsStored: number; driversStored: number; identity: unknown }> {
  const [cars, drivers] = await Promise.all([readCars(ctx), readDrivers(ctx)]);
  const vehicleRecords = dedupeById(
    cars.map(mapCarItem).filter(Boolean) as Array<{ wd_car_id: number }>,
    (v) => v.wd_car_id,
  );
  const driverRecords = dedupeById(
    drivers.map(mapDriverItem).filter(Boolean) as Array<{ wd_driver_id: number }>,
    (d) => d.wd_driver_id,
  );

  if (vehicleRecords.length) await ctx.rpc('wd_upsert_vehicles_audited', { p_vehicles: vehicleRecords });
  if (driverRecords.length) await ctx.rpc('wd_upsert_drivers_audited', { p_drivers: driverRecords });

  await ctx.kv.set(KV_LAST_FLEET_SYNC, new Date().toISOString());
  ctx.log('info', 'webdispecink fleet synced', {
    carsRead: cars.length,
    carsStored: vehicleRecords.length,
    driversRead: drivers.length,
    driversStored: driverRecords.length,
  });
  const identity = await vedlejsiKrok(ctx, 'wd_propose_identity', {});
  selhatNahlas(ctx, identity, 'webdispecink: číselník uložen, ale návrhy vazeb identity selhaly');
  return { carsStored: vehicleRecords.length, driversStored: driverRecords.length, identity };
}

/**
 * Vedlejší krok (návrhy vazeb, projekce na dvojčata) nesmí vrátit, co už je
 * uložené (registr, kurzor) — ale nesmí ani mlčet: spolknuté selhání by běh
 * vykázalo jako zdravý. Běh proto skončí CHYBOU se srozumitelnou zprávou;
 * platforma ji zapíše jako událost 'error' (register_plugin_event → blok
 * stavu zdrojů) a plánovač jen naplánuje další termín. Chyba se hlásí
 * JAKÁKOLI, i vrácená jako objekt ({error: {…}}), ne jen jako text.
 */
function selhatNahlas(ctx: Ctx, krok: unknown, co: string): void {
  const chyba = (krok as { error?: unknown } | null)?.error;
  if (chyba == null) return;
  const zprava = `${co}: ${typeof chyba === 'string' ? chyba : JSON.stringify(chyba)}`;
  ctx.log('error', zprava);
  throw new Error(zprava);
}

/** Vedlejší krok přes RPC: selhání VRÁTÍ (nevyhodí), aby se uložené neztratilo. */
async function vedlejsiKrok(ctx: Ctx, fn: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await ctx.rpc(fn, args);
    ctx.log('info', `webdispecink ${fn}`, { result: res });
    return res;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Kde začíná okno čtení: uložený kurzor MINUS překryv. Dodavatel knihu jízd
 * i výkony z tachografu opravuje zpětně (soukromá/služební, ověřené dny) a
 * stahuje se jednou denně — kurzor „od posledně" by první verzi zmrazil
 * navždy. Překryv stojí ŘÁDKY, ne dotazy (dotaz je per vozidlo / řidič),
 * a zápis je idempotentní upsert. Kurzor je v dodavatelově formátu, v UTC
 * (wdStamp); nečitelný kurzor = přečíst znovu okno backfill, ne nic.
 */
function oknoOd(ctx: Ctx, cursor: unknown, backfillDaysKey: string, overlapHoursKey: string): string {
  const backfill = wdStamp(new Date(Date.now() - num(ctx, backfillDaysKey, 30) * 86_400_000));
  if (typeof cursor !== 'string' || !cursor) return backfill;
  const at = Date.parse(`${cursor.replace(' ', 'T')}Z`);
  if (!Number.isFinite(at)) {
    ctx.log('warn', 'webdispecink kurzor nečitelný — čtu znovu okno backfill', { cursor });
    return backfill;
  }
  return wdStamp(new Date(Math.min(at, Date.now()) - num(ctx, overlapHoursKey, 48) * 3_600_000));
}

/** Dodavatel čte okno jako 'YYYY-MM-DD HH:mm:ss', ne ISO. */
function wdStamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Kniha jízd je PER VOZIDLO, takže velikost flotily JE počet dotazů.
 *
 * Pracovní seznam je `wd_list_sync_vehicle_ids` — tedy to, co o aktivních
 * vozidlech ví REGISTR, ne co zrovna vrátil dodavatel. Prázdný seznam proto
 * není „hotovo", ale „napřed doběhni sync flotily", a říká se to nahlas.
 *
 * Tři záruky převzaté z tcars konektoru, kde je vynutila skutečná vada:
 *   · per-vozidlo try/catch — jedno nečitelné vozidlo nesmí shodit celý sběr
 *   · pauza mezi voláními a strop na počet volání — slušnost k cizímu
 *     produkčnímu systému a pojistka proti tomu, aby z jednoho ticku byly
 *     stovky dotazů
 *   · kurzor se posune JEN když se celé okno opravdu uložilo; vozidlo, které
 *     selhalo, za okno žádné řádky nemá a posun kurzoru by je NENÁVRATNĚ
 *     přeskočil. Držet kurzor = přečíst okno znovu (levné) místo ztráty dat.
 */
async function syncRides(
  ctx: Ctx,
): Promise<{ vehicles: number; rides: number; failed: number; projection: unknown }> {
  const client = clientFor(ctx);
  const creds = credsFor(ctx);

  const from = oknoOd(ctx, await ctx.kv.get(KV_LAST_RIDE_SYNC), 'rideBackfillDays', 'rideOverlapHours');
  const to = wdStamp(new Date());

  const listed = (await ctx.rpc('wd_list_sync_vehicle_ids')) as
    | Array<{ wd_car_id: number }>
    | null;
  const carIds = (listed ?? []).map((r) => r.wd_car_id).filter((n) => Number.isFinite(n) && n > 0);

  if (!carIds.length) {
    ctx.log('warn', 'webdispecink rides skipped — registr nezná žádné aktivní vozidlo', {
      hint: 'nejdřív cron.sync_fleet',
    });
    return { vehicles: 0, rides: 0, failed: 0 };
  }

  const pauseMs = num(ctx, 'ridePauseMs', 200);
  const callBudget = num(ctx, 'rideCallBudget', 0); // 0 = bez stropu

  let total = 0;
  let failed = 0;
  let calls = 0;
  let budgetExhausted = false;

  for (const carId of carIds) {
    if (callBudget > 0 && calls >= callBudget) {
      budgetExhausted = true;
      ctx.log('warn', 'webdispecink ride budget exhausted — okno zůstává otevřené', {
        callBudget,
        done: calls,
      });
      break;
    }
    try {
      const book = await client.getCarLogBook(creds, carId, from, to);
      calls++;
      const rides = dedupeById(
        book.map(mapRideItem).filter(Boolean) as Array<{ wd_ride_id: number }>,
        (r) => r.wd_ride_id,
      );
      if (rides.length) {
        await ctx.rpc('wd_upsert_rides_audited', { p_rides: rides });
        total += rides.length;
      }
    } catch (err) {
      failed++;
      calls++;
      ctx.log('warn', 'webdispecink log book failed — pokračuji dalším vozidlem', {
        vehicle: carId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (pauseMs > 0) await sleep(pauseMs);
  }

  if (failed === 0 && !budgetExhausted) {
    await ctx.kv.set(KV_LAST_RIDE_SYNC, to);
  } else {
    ctx.log('warn', 'webdispecink ride cursor held back — příští běh zopakuje okno', {
      from,
      failed,
      budgetExhausted,
    });
  }

  ctx.log('info', 'webdispecink rides synced', {
    vehicles: carIds.length,
    rides: total,
    failed,
    from,
    to,
  });
  // Jízdy → události 'trip' na dvojčatech (wd_project_rides). Běží i bez nových
  // jízd: vazba potvrzená od minula zpřístupní čekající.
  const projection = await vedlejsiKrok(ctx, 'wd_project_rides', { p_okno_min: num(ctx, 'projectionWindowMin', 180) });
  selhatNahlas(ctx, projection, 'webdispecink: jízdy uloženy, ale projekce na dvojčata selhala');
  return { vehicles: carIds.length, rides: total, failed, projection };
}

/**
 * Výkony řidičů podle tachografu (_getDriverWorkTacho) — PER ŘIDIČ, takže počet
 * řidičů JE počet dotazů (IdDriver je povinné, bez něj API vrací prázdno). Stejné
 * tři záruky jako u knihy jízd: per-řidič try/catch, pauza + strop, a kurzor se
 * posune JEN když celé okno bez chyby doběhlo (držet kurzor = přečíst okno znovu,
 * upsert je idempotentní podle driver×den×vozidlo).
 */
async function syncWorktime(
  ctx: Ctx,
): Promise<{ drivers: number; days: number; failed: number; projection: unknown }> {
  const client = clientFor(ctx);
  const creds = credsFor(ctx);

  const from = oknoOd(ctx, await ctx.kv.get(KV_LAST_WORKTIME_SYNC), 'worktimeBackfillDays', 'worktimeOverlapHours');
  const to = wdStamp(new Date());

  // Worktime je per iddriver → potřebujeme seznam řidičů. `disabled=0` = aktivní.
  const drivers = await client.getDriversList(creds, 0);
  const driverIds = [...new Set(
    drivers.map((d) => Number(d.iddriver)).filter((n) => Number.isFinite(n) && n > 0),
  )];

  if (!driverIds.length) {
    ctx.log('warn', 'webdispecink worktime skipped — žádný aktivní řidič v číselníku', {});
    return { drivers: 0, days: 0, failed: 0 };
  }

  const pauseMs = num(ctx, 'ridePauseMs', 200);
  const callBudget = num(ctx, 'rideCallBudget', 0); // 0 = bez stropu

  let total = 0;
  let failed = 0;
  let calls = 0;
  let budgetExhausted = false;

  for (const driverId of driverIds) {
    if (callBudget > 0 && calls >= callBudget) {
      budgetExhausted = true;
      ctx.log('warn', 'webdispecink worktime budget exhausted — okno zůstává otevřené', { callBudget, done: calls });
      break;
    }
    try {
      const rows = await client.getDriverWorkTacho(creds, driverId, from, to);
      calls++;
      // Upsert dedupuje podle (driver, den, vozidlo) sám — per-řidič dávka je
      // už rozlišená dny/vozidly, tady se nic slučovat nemusí.
      const records = rows.map(mapWorktimeItem).filter((r): r is NonNullable<typeof r> => r !== null);
      if (records.length) {
        await ctx.rpc('wd_upsert_worktime_audited', { p_worktime: records });
        total += records.length;
      }
    } catch (err) {
      failed++;
      calls++;
      ctx.log('warn', 'webdispecink worktime failed — pokračuji dalším řidičem', {
        driver: driverId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (pauseMs > 0) await sleep(pauseMs);
  }

  if (failed === 0 && !budgetExhausted) {
    await ctx.kv.set(KV_LAST_WORKTIME_SYNC, to);
  } else {
    ctx.log('warn', 'webdispecink worktime cursor held back — příští běh zopakuje okno', { from, failed, budgetExhausted });
  }

  ctx.log('info', 'webdispecink worktime synced', { drivers: driverIds.length, days: total, failed, from, to });
  // Denní výkony → 'driver_hours_day' na dvojčatech řidičů (wd_project_worktime).
  const projection = await vedlejsiKrok(ctx, 'wd_project_worktime', { p_okno_min: num(ctx, 'projectionWindowMin', 180) });
  selhatNahlas(ctx, projection, 'webdispecink: výkony uloženy, ale projekce na dvojčata selhala');
  return { drivers: driverIds.length, days: total, failed, projection };
}

/**
 * Překročení rychlosti (_getCarOverSpeed) — PER VOZ (jako kniha jízd). Stejné tři
 * záruky: per-vozidlo try/catch, pauza + strop, kurzor drží při chybě. Pracovní
 * seznam vozidel je registr (`wd_list_sync_vehicle_ids`), ne co vrátil dodavatel.
 */
async function syncOverspeed(ctx: Ctx): Promise<{ vehicles: number; events: number; failed: number }> {
  const client = clientFor(ctx);
  const creds = credsFor(ctx);

  const cursor = await ctx.kv.get(KV_LAST_OVERSPEED_SYNC);
  const from =
    typeof cursor === 'string' && cursor
      ? cursor
      : wdStamp(new Date(Date.now() - num(ctx, 'rideBackfillDays', 30) * 86_400_000));
  const to = wdStamp(new Date());

  const listed = (await ctx.rpc('wd_list_sync_vehicle_ids')) as Array<{ wd_car_id: number }> | null;
  const carIds = (listed ?? []).map((r) => r.wd_car_id).filter((n) => Number.isFinite(n) && n > 0);
  if (!carIds.length) {
    ctx.log('warn', 'webdispecink overspeed skipped — registr nezná žádné aktivní vozidlo', { hint: 'nejdřív cron.sync_fleet' });
    return { vehicles: 0, events: 0, failed: 0 };
  }

  const pauseMs = num(ctx, 'ridePauseMs', 200);
  const callBudget = num(ctx, 'rideCallBudget', 0);

  let total = 0;
  let failed = 0;
  let calls = 0;
  let budgetExhausted = false;

  for (const carId of carIds) {
    if (callBudget > 0 && calls >= callBudget) {
      budgetExhausted = true;
      ctx.log('warn', 'webdispecink overspeed budget exhausted — okno zůstává otevřené', { callBudget, done: calls });
      break;
    }
    try {
      const rows = await client.getCarOverSpeed(creds, carId, from, to);
      calls++;
      const records = rows.map(mapOverspeedItem).filter((r): r is NonNullable<typeof r> => r !== null);
      if (records.length) {
        await ctx.rpc('wd_upsert_overspeed_audited', { p_events: records });
        total += records.length;
      }
    } catch (err) {
      failed++;
      calls++;
      ctx.log('warn', 'webdispecink overspeed failed — pokračuji dalším vozidlem', {
        vehicle: carId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (pauseMs > 0) await sleep(pauseMs);
  }

  if (failed === 0 && !budgetExhausted) {
    await ctx.kv.set(KV_LAST_OVERSPEED_SYNC, to);
  } else {
    ctx.log('warn', 'webdispecink overspeed cursor held back — příští běh zopakuje okno', { from, failed, budgetExhausted });
  }

  ctx.log('info', 'webdispecink overspeed synced', { vehicles: carIds.length, events: total, failed, from, to });
  return { vehicles: carIds.length, events: total, failed };
}

/**
 * Statistika řidičů (_getStaDrivers) — FLEET-WIDE, jedno volání za okno vrací
 * všechny řidiče (služební/soukromé km, doba den/noc). Ukládá se jeden snapshot
 * per řidič; `period_from`/`period_to` říkají, za jaké okno platí.
 */
async function syncDriverStats(ctx: Ctx): Promise<{ drivers: number }> {
  try {
    const client = clientFor(ctx);
    const creds = credsFor(ctx);
    const days = num(ctx, 'driverStatsWindowDays', 7);
    const fromDate = new Date(Date.now() - days * 86_400_000);
    const periodFrom = fromDate.toISOString().slice(0, 10);
    const periodTo = new Date().toISOString().slice(0, 10);

    const rows = await client.getDriverStats(creds, wdStamp(fromDate), wdStamp(new Date()));
    const records = rows
      .map((r) => mapDriverStatItem(r, periodFrom, periodTo))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (records.length) await ctx.rpc('wd_upsert_driver_stats_audited', { p_stats: records });

    await ctx.kv.set(KV_LAST_DRIVERSTATS_SYNC, { at: new Date().toISOString(), drivers: records.length, periodFrom, periodTo });
    ctx.log('info', 'webdispecink driver stats synced', { drivers: records.length, periodFrom, periodTo });
    return { drivers: records.length };
  } catch (err) {
    ctx.log('error', 'webdispecink driver stats failed', { error: err instanceof Error ? err.message : String(err) });
    return { drivers: 0 };
  }
}
