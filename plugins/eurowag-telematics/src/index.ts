/**
 * Eurowag Telematics — data_source plugin (ingest connector).
 *
 * Kind history: born as backend_provider, re-kinded 2026-07-26 — that kind is
 * LLM-shaped (supports_chat/vision → ai_provider_registry) and this plugin is
 * a connector of OBSERVATIONS. Its spine is the ingest one: source_spec →
 * materialize_data_source → agent_knowledge_sources (inactive until the
 * instance completes the 4D classification), adapter loaded by the
 * source-broker plugin host.
 *
 * Webdispečink moved under Eurowag and the SOAP endpoint the platform's
 * svc-webdispecink was built against is a dead end. This plugin speaks the
 * REST successor instead, and it is a PLUGIN rather than core because a
 * deployment that has nothing to do with Eurowag should not carry the
 * integration, the outbound allowlist, or the credentials.
 *
 * Direction (0.2.0, 2026-09-27): reads the vendor and writes onto the GENERIC
 * RAW LANE (`source_catalog_rows` via `audience_sync_source_catalog`): vehicles
 * and drivers as codebook snapshots, trips and vehicle states as series. It
 * creates NO twins — 0.1.0 did (`twin_upsert_entity_audited`), against the
 * owner's decision that an identifier binds to a twin only through a CONFIRMED
 * binding. After storing it asks the platform to propose bindings
 * (`ew_propose_identity`) and to project onto twins (`ew_project_catalog`),
 * which uses confirmed bindings only. No positions are stored anywhere
 * (coordinates, speed, trip places): the owner decided "polohy ne".
 *
 * Everything reaches the outside world through ctx.fetch, so the sandbox's
 * network allowlist (see manifest) is the real boundary — this module cannot
 * widen it.
 *
 * @module
 */
import { EwClient } from './ew-client.js';
import {
  KIND,
  mapVehicle,
  mapDriver,
  mapVehicleState,
  mapTrip,
  type KatalogovyRadek,
  type EwVehicleState,
  type EwDriver,
  type EwTrip,
} from './katalog.js';

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

const KV_LAST_STATE_POLL = 'eurowag:last-state-poll';
const KV_LAST_FLEET_SYNC = 'eurowag:last-fleet-sync';
const KV_LAST_TRIP_SYNC = 'eurowag:last-trip-sync';

const TIMEOUT_MS = 20_000;

const str = (ctx: Ctx, key: string, fallback = ''): string =>
  typeof ctx.config[key] === 'string' ? (ctx.config[key] as string) : fallback;
const num = (ctx: Ctx, key: string, fallback: number): number =>
  typeof ctx.config[key] === 'number' ? (ctx.config[key] as number) : fallback;

/** Slušnost k cizímu produkčnímu systému — ne naše throttlování. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function clientFor(ctx: Ctx): EwClient {
  return new EwClient(
    { apiKey: str(ctx, 'apiKey'), username: str(ctx, 'username'), password: str(ctx, 'password') },
    {
      baseUrl: str(ctx, 'baseUrl', 'https://telematics.eurowag.com/customer-api/v1'),
      tokenUrl: str(ctx, 'tokenUrl', 'https://login.eurowag.com/auth/realms/eurowag/protocol/openid-connect/token'),
      clientId: str(ctx, 'clientId', 'dfo-client'),
      userAgent: str(ctx, 'userAgent') || undefined,
      timeoutMs: TIMEOUT_MS,
      fetchImpl: (url, init) => ctx.fetch(url, init),
    },
  );
}

/** The API answers either a bare array or {data:[…]}; callers should not care. */
function rows<T = Record<string, unknown>>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

function maxPer100km(ctx: Ctx): number {
  return num(ctx, 'maxPlausibleConsumptionPer100km', 100);
}

/** ISO čas o N dní zpět — okno pro první běh, kdy ještě není kurzor. */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ── sandbox entry ────────────────────────────────────────────────────────────

export async function init(ctx: Ctx): Promise<void> {
  ctx.log('info', 'eurowag-telematics initializing', { version: ctx.plugin.version, tenant: ctx.tenant.id });

  const pollCron = stateCron(num(ctx, 'vehicleStatePollSeconds', 3600));
  if (pollCron) ctx.schedule(pollCron, 'cron.poll_vehicle_states');

  const fleetCron = str(ctx, 'fleetSyncCron', '0 3 * * *');
  ctx.schedule(fleetCron, 'cron.sync_fleet');

  const tripCron = str(ctx, 'tripSyncCron', '40 3 * * *');
  ctx.schedule(tripCron, 'cron.sync_trips');

  ctx.log('info', 'eurowag-telematics ready', { pollCron, fleetCron, tripCron });
}

/**
 * Rozvrh pollu stavů z periody v sekundách. Stav (tachometr, hladina) se mění
 * po hodinách, ne po minutách, a denní rozpočet API (2 000 dotazů) je SDÍLENÝ
 * s Webdispečinkem — proto výchozí hodina. ⛔ 0 (nebo méně) = VYPNUTO, ne
 * „každou minutu": `Math.max(1, 0)` u Webdispečinku z nuly udělal nejhustší
 * možný poll (idata 61_), tady nula znamená to, co si člověk myslí.
 */
export function stateCron(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `*/${minutes} * * * *`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return hours === 1 ? '7 * * * *' : `7 */${hours} * * *`;
}

export async function handle(ctx: Ctx, capability: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (capability) {
    case 'cron.sync_fleet':
      return await syncFleet(ctx);
    case 'cron.poll_vehicle_states':
      return await pollVehicleStates(ctx);
    case 'cron.sync_trips':
      return await syncTrips(ctx);
    case 'http.GET./vehicles-states':
      return { rows: await readVehicleStates(ctx) };
    case 'http.GET./drivers':
      return { rows: await clientFor(ctx).drivers() };
    case 'http.GET./trips':
      return { rows: await readTripsPreview(ctx, args) };
    default:
      throw new Error(`eurowag-telematics: neznámá capability '${capability}'`);
  }
}

export async function dispose(_ctx: Ctx): Promise<void> {
  /* stateless — kurzory žijí v kv, spojení je bezstavové (token cachuje klient) */
}

// ── surová dráha + dvojčata ──────────────────────────────────────────────────

/** Jméno zdroje, pod kterým plugin zapisuje (broker ho vynucuje — jiné odmítne). */
const ZDROJ = 'eurowag-telematics';
const CHUNK = 500;

const neprazdne = <T>(xs: Array<T | null>): T[] => xs.filter((x): x is T => x !== null);

/**
 * Snapshot = CELÁ množina v JEDNÉ dávce (dělit ji nelze: druhá dávka by smazala
 * první). Series = přírůstek, smí se dělit.
 */
async function zapsat(ctx: Ctx, kind: string, mode: 'snapshot' | 'series', radky: KatalogovyRadek[]): Promise<number> {
  const davky =
    mode === 'snapshot'
      ? [radky]
      : Array.from({ length: Math.ceil(radky.length / CHUNK) }, (_, i) => radky.slice(i * CHUNK, (i + 1) * CHUNK));
  for (const davka of davky) {
    await ctx.rpc('audience_sync_source_catalog', { p_source_slug: ZDROJ, p_kind: kind, p_mode: mode, p_rows: davka });
  }
  return radky.length;
}

/**
 * Vedlejší krok (návrhy vazeb, projekce na dvojčata) nesmí vrátit, co už je
 * uložené (katalog, kurzor) — ale nesmí ani mlčet: spolknuté selhání by běh
 * vykázalo jako zdravý. Běh proto skončí CHYBOU se srozumitelnou zprávou;
 * platforma ji zapíše jako událost 'error' (register_plugin_event → blok stavu
 * zdrojů) a plánovač jen naplánuje další termín. Chyba se hlásí JAKÁKOLI,
 * i vrácená jako objekt ({error: {…}}), ne jen jako text.
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
    ctx.log('info', `eurowag: ${fn}`, { result: res });
    return res;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const projekce = (ctx: Ctx) =>
  vedlejsiKrok(ctx, 'ew_project_catalog', { p_okno_min: num(ctx, 'projectionWindowMin', 180) });

/**
 * Číselník (denně): vozidla (monitoredObjectId + SPZ) a řidiči, pak NÁVRHY
 * vazeb (ew_propose_identity — nic nezakládá, potvrzuje člověk).
 */
async function syncFleet(ctx: Ctx): Promise<{ vehicles: number; drivers: number; identity: unknown }> {
  const client = clientFor(ctx);
  const vehicles = neprazdne(rows<EwVehicleState>(await client.vehiclesStates()).map(mapVehicle));
  const drivers = neprazdne((await client.drivers<EwDriver>()).map(mapDriver));
  const filtr = await client.filterIds();
  await zapsat(ctx, KIND.vehicle, 'snapshot', vehicles);
  await zapsat(ctx, KIND.driver, 'snapshot', drivers);
  await ctx.kv.set(KV_LAST_FLEET_SYNC, new Date().toISOString());
  ctx.log('info', 'eurowag: číselník zapsán', {
    vehicles: vehicles.length,
    drivers: drivers.length,
    filterObjects: filtr === null ? 'bez filtru' : filtr.length,
  });
  const identity = await vedlejsiKrok(ctx, 'ew_propose_identity', {});
  selhatNahlas(ctx, identity, 'eurowag: číselník uložen, ale návrhy vazeb identity selhaly');
  overitSoupis(ctx, filtr, vehicles.map((v) => v.externalId));
  return { vehicles: vehicles.length, drivers: drivers.length, identity };
}

/**
 * Soupis vozidel proti FILTRU API klíče. API vidí jen objekty, které dodavatel
 * klíči povolil (`configuration.filter`), a neumí říct, co leží mimo něj —
 * 27. 9. filtr pouštěl 6 vozů a jeden z flotily chyběl, aniž co selhalo.
 * Rozdíl mezi filtrem a tím, co /vehicles-states vrátí, by jinak zmizel potichu:
 * číselník je uložený, běh skončí CHYBOU, která říká, co s tím.
 */
function overitSoupis(ctx: Ctx, filtr: string[] | null, vraceno: string[]): void {
  if (filtr === null) return; // dodavatel filtr neposlal — není s čím porovnat
  const maji = new Set(vraceno);
  const veFiltru = new Set(filtr);
  const chybi = filtr.filter((id) => !maji.has(id)).length;
  const navic = vraceno.filter((id) => !veFiltru.has(id)).length;
  if (chybi === 0 && navic === 0) return;
  const zprava =
    `eurowag: číselník uložen, ale soupis vozidel nesedí s filtrem API klíče — filtr ${filtr.length} objektů, ` +
    `/vehicles-states vrátil ${vraceno.length} (ve filtru a nevráceno: ${chybi}, vráceno mimo filtr: ${navic}). ` +
    'Oprava není v kódu: filtr klíče upravuje dodavatel (Eurowag) — požádat o jeho rozšíření/opravu.';
  ctx.log('error', zprava);
  throw new Error(zprava);
}

/**
 * Stav vozidla → řada (tachometr, hladina, zapalování; BEZ polohy), pak
 * projekce. Výpadek dodavatele běh ukončí chybou — příští termín to zopakuje.
 */
async function pollVehicleStates(ctx: Ctx): Promise<{ recorded: number; projection: unknown }> {
  const states = rows<EwVehicleState>(await clientFor(ctx).vehiclesStates());
  const radky = neprazdne(states.map(mapVehicleState));
  const recorded = await zapsat(ctx, KIND.vehicleState, 'series', radky);
  await ctx.kv.set(KV_LAST_STATE_POLL, { at: new Date().toISOString(), read: states.length, recorded });
  ctx.log('info', 'eurowag: stavy vozidel zapsány', { read: states.length, recorded });
  const projection = await projekce(ctx);
  selhatNahlas(ctx, projection, 'eurowag: stavy uloženy, ale projekce na dvojčata selhala');
  return { recorded, projection };
}

/**
 * Kde začíná okno jízd: uložený kurzor MINUS překryv. Dodavatel jízdy
 * dopočítává a opravuje zpětně a stahuje se jednou denně — kurzor „od
 * posledně" by první verzi zmrazil. Překryv stojí ŘÁDKY, ne dotazy (dotaz je
 * per vozidlo), zápis je idempotentní upsert. Nečitelný kurzor = backfill.
 */
function tripWindowFrom(ctx: Ctx, cursor: unknown): string {
  const backfill = daysAgoIso(num(ctx, 'tripBackfillDays', 30));
  if (typeof cursor !== 'string' || !cursor) return backfill;
  const at = Date.parse(cursor);
  if (!Number.isFinite(at)) {
    ctx.log('warn', 'eurowag: kurzor jízd nečitelný — čtu znovu okno backfill', { cursor });
    return backfill;
  }
  return new Date(Math.min(at, Date.now()) - num(ctx, 'tripOverlapHours', 48) * 3_600_000).toISOString();
}

/**
 * Jízdy → řada, pak projekce. Jízdy jsou PER VOZIDLO, takže velikost flotily
 * JE počet dotazů. Pracovní seznam = vozidla z /vehicles-states (jeden dotaz).
 * Tři záruky převzaté z Webdispečink konektoru, kde je vynutila skutečná vada:
 *   · per-vozidlo try/catch — jedno nečitelné vozidlo nesmí shodit celý sběr,
 *   · pauza mezi voláními a strop na počet volání,
 *   · kurzor se posune JEN když celé okno bez chyby doběhlo (držet kurzor =
 *     přečíst okno znovu, levné; posunout = nenávratně přeskočit).
 */
async function syncTrips(
  ctx: Ctx,
): Promise<{ vehicles: number; trips: number; failed: number; projection: unknown }> {
  const client = clientFor(ctx);
  const monitoredObjectIds = neprazdne(
    rows<EwVehicleState>(await client.vehiclesStates()).map((v) => {
      const id = Number(v?.monitoredObjectId);
      return Number.isInteger(id) && id > 0 ? id : null;
    }),
  );

  const from = tripWindowFrom(ctx, await ctx.kv.get(KV_LAST_TRIP_SYNC));
  const to = new Date().toISOString();
  const max = maxPer100km(ctx);
  const pauseMs = num(ctx, 'tripPauseMs', 200);
  const callBudget = num(ctx, 'tripCallBudget', 0); // 0 = bez stropu

  let total = 0;
  let failed = 0;
  let budgetExhausted = false;
  // Strop počítá skutečná volání API (stránky po 29), ne vozidla — rozpočet
  // dodavatele (2 000/den) se čerpá po dotazech.
  const callsBefore = client.calls;
  const calls = () => client.calls - callsBefore;

  for (const moId of monitoredObjectIds) {
    if (callBudget > 0 && calls() >= callBudget) {
      budgetExhausted = true;
      ctx.log('warn', 'eurowag: strop volání jízd vyčerpán — okno zůstává otevřené', { callBudget, done: calls() });
      break;
    }
    try {
      const trips = await client.trips<EwTrip>(moId, from, to);
      total += await zapsat(ctx, KIND.trip, 'series', neprazdne(trips.map((t) => mapTrip(t, max))));
    } catch (err) {
      failed++;
      ctx.log('warn', 'eurowag: jízdy vozidla selhaly — pokračuji dalším', {
        monitoredObjectId: moId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (pauseMs > 0) await sleep(pauseMs);
  }

  if (failed === 0 && !budgetExhausted) {
    await ctx.kv.set(KV_LAST_TRIP_SYNC, to);
  } else {
    ctx.log('warn', 'eurowag: kurzor jízd zadržen — příští běh zopakuje okno', { from, failed, budgetExhausted });
  }

  ctx.log('info', 'eurowag: jízdy zapsány', { vehicles: monitoredObjectIds.length, trips: total, failed, calls: calls(), from, to });
  // Běží i bez nových jízd: vazba potvrzená od minula zpřístupní čekající.
  const projection = await projekce(ctx);
  selhatNahlas(ctx, projection, 'eurowag: jízdy uloženy, ale projekce na dvojčata selhala');
  return { vehicles: monitoredObjectIds.length, trips: total, failed, projection };
}

// ── read-only náhledy (http.GET, ne zápis) ────────────────────────────────────

/**
 * Náhled stavů pro ověření přístupu — BEZ POLOHY: souřadnice a rychlost se
 * z odpovědi odstraní i tady (majitel: polohy ne), zůstane čas pozorování.
 */
async function readVehicleStates(ctx: Ctx): Promise<EwVehicleState[]> {
  return rows<EwVehicleState>(await clientFor(ctx).vehiclesStates()).map((v) => ({
    ...v,
    gpsData: v.gpsData ? { time: v.gpsData.time ?? null } : v.gpsData,
  }));
}

/**
 * Náhled jízd JEDNOHO vozidla — `monitoredObjectId` je povinný a okno taky.
 * Odmítnout beats hádat: tiše dosazené okno by vypadalo jako odpověď, přitom
 * popisuje období, na které se nikdo neptal.
 */
async function readTripsPreview(ctx: Ctx, args?: Record<string, unknown>): Promise<EwTrip[]> {
  const moId = Number(args?.monitoredObjectId);
  const from = typeof args?.from === 'string' ? args.from : '';
  const to = typeof args?.to === 'string' ? args.to : '';
  if (!Number.isFinite(moId) || moId <= 0 || !from || !to) {
    throw new Error('EW_TRIPS_ARGS: monitoredObjectId, from a to jsou povinné (from/to jako ISO-8601)');
  }
  return clientFor(ctx).trips<EwTrip>(moId, from, to);
}

