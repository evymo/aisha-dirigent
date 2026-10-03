/**
 * AVP portal (Kupson) — data_source plugin (ingest connector).
 *
 * Čte z REST API výdejních stojanů PHM:
 *   · karty (řidiči, vozidla/stroje) a nádrže — číselník, denně,
 *   · výdej paliva — inkrementálně podle času ZÁPISU na serveru,
 *   · návozy do nádrží a denní uzávěrky nádrží —
 * a zapisuje je na OBECNOU SUROVOU DRÁHU stacku (`source_catalog_rows` přes
 * `audience_sync_source_catalog`) — jádro o AVP nic neví, plugin je soběstačný.
 * Číselník (karty, nádrže) jde jako `snapshot` (co v portálu zmizí, zmizí i tady;
 * prázdná dávka dobrá data nesmaže), výdej a události nádrží jako `series`
 * (přírůstek, historie zůstává). Nic neodvozuje a NEZAKLÁDÁ dvojčata
 * (rozhodnutí majitele 2026-09-24, viz mappers.ts).
 *
 * Endpoint, jméno databáze i pověření přicházejí v `ctx.config` z administrace
 * zdroje (pověření šifrovaně, set_data_source_secrets); v kódu není nic z toho.
 * Ven se jde jen přes ctx.fetch, takže hranicí je síťová politika manifestu.
 *
 * @module
 */
import { createAvpClient, type AvpClient, type AvpSession } from './avp-client.js';
import {
  KIND,
  mapCard,
  mapTank,
  mapFueling,
  mapRefill,
  mapRegister,
  mapChip,
  nejpozdeji,
  type KatalogovyRadek,
  type AvpCard,
  type AvpTank,
  type AvpFueling,
  type AvpTankRefill,
  type AvpTankRegister,
  type AvpChip,
} from './mappers.js';

interface Ctx {
  plugin: { version: string };
  tenant: { id: string };
  config: Record<string, unknown>;
  log(level: string, msg: string, meta?: Record<string, unknown>): void;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  kv: { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void> };
  rpc(fn: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Deklarace rozvrhu: host v daném cronu spustí `capability` z manifestu. */
  schedule(cron: string, capability: string): void;
}

const KV_FUELING_CURSOR = 'avp:fueling-cursor';
const KV_TANK_CURSOR = 'avp:tank-cursor';
const CHUNK = 500;
/**
 * Překryv kurzoru nádrží. Návozy a uzávěrky se filtrují podle času UDÁLOSTI,
 * ale na server dorazí se zpožděním (synchronizace stojanů). Kurzor „teď" by
 * pozdě zapsaný záznam přeskočil navždy — to byla vada předchozí verze. Upsert
 * je idempotentní, takže překryv stojí jen pár řádků navíc.
 */
const TANK_OVERLAP_MS = 48 * 3_600_000;

const str = (ctx: Ctx, key: string, fallback = ''): string =>
  typeof ctx.config[key] === 'string' ? (ctx.config[key] as string) : fallback;
const num = (ctx: Ctx, key: string, fallback: number): number => {
  const v = ctx.config[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

function clientFor(ctx: Ctx): AvpClient {
  return createAvpClient({
    baseUrl: str(ctx, 'baseUrl'),
    database: str(ctx, 'database'),
    timeoutMs: num(ctx, 'requestTimeoutMs', 60_000),
    fetchImpl: (url, init) => ctx.fetch(url, init),
  });
}

function signIn(ctx: Ctx, client: AvpClient): Promise<AvpSession> {
  return client.signIn({ username: str(ctx, 'username'), password: str(ctx, 'password') });
}

const daysAgoIso = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

/** Jméno zdroje, pod kterým plugin zapisuje (broker ho vynucuje — jiné odmítne). */
const ZDROJ = 'avp-portal';

/**
 * Snapshot = CELÁ množina v JEDNÉ dávce (dělit ji nelze: druhá dávka by smazala
 * první). Series = přírůstek, smí se dělit.
 */
async function zapsat(ctx: Ctx, kind: string, mode: 'snapshot' | 'series', radky: KatalogovyRadek[]): Promise<number> {
  const davky = mode === 'snapshot' ? [radky] : Array.from({ length: Math.ceil(radky.length / CHUNK) }, (_, i) => radky.slice(i * CHUNK, (i + 1) * CHUNK));
  for (const davka of davky) {
    await ctx.rpc('audience_sync_source_catalog', { p_source_slug: ZDROJ, p_kind: kind, p_mode: mode, p_rows: davka });
  }
  return radky.length;
}

const neprazdne = <T>(xs: Array<T | null>): T[] => xs.filter((x): x is T => x !== null);

/**
 * Vedlejší krok (návrhy vazeb, projekce na dvojčata) nesmí vrátit, co už je
 * uložené (katalog, kurzor) — ale nesmí ani mlčet: spolknuté selhání by běh
 * vykázalo jako zdravý a vadu schovalo. Běh proto skončí CHYBOU se
 * srozumitelnou zprávou; platforma ji zapíše jako událost 'error'
 * (register_plugin_event → blok stavu zdrojů v administraci) a plánovač jen
 * naplánuje další termín.
 */
function selhatNahlas(ctx: Ctx, krok: unknown, co: string): void {
  // JAKÁKOLI chyba, ne jen text: RPC může vrátit {error: {…}} místo výjimky
  // (tvar PostgREST/brokeru) — kdyby se kontroloval jen řetězec, prošla by tiše.
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
    ctx.log('info', `avp-portal: ${fn}`, { result: res });
    return res;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Číselník: karty, nádrže a čipy. Pak NÁVRHY vazeb — která karta je které
 * vozidlo/řidič a který čip patří ke které kartě (avp_propose_identity; nic
 * nezakládá, potvrzuje člověk).
 */
export async function syncFleet(ctx: Ctx): Promise<{ cards: number; tanks: number; chips: number; identity: unknown }> {
  const client = clientFor(ctx);
  const session = await signIn(ctx, client);
  const cards = neprazdne((await client.list<AvpCard>(session, 'cards', {
    only: ['id', 'itemNumber', 'name', 'cardType', 'inventoryNumber', 'vehicleType'],
  })).map(mapCard));
  const tanks = neprazdne((await client.list<AvpTank>(session, 'tanks', {
    only: ['id', 'name', 'itemNumber', 'productId', 'maximumVolume'],
  })).map(mapTank));
  const chips = neprazdne((await client.list<AvpChip>(session, 'chips', {
    only: ['chipCode', 'cardId'],
  })).map(mapChip));
  await zapsat(ctx, KIND.card, 'snapshot', cards);
  await zapsat(ctx, KIND.tank, 'snapshot', tanks);
  await zapsat(ctx, KIND.chip, 'snapshot', chips);
  ctx.log('info', 'avp-portal: číselník zapsán', { cards: cards.length, tanks: tanks.length, chips: chips.length });
  const identity = await vedlejsiKrok(ctx, 'avp_propose_identity', {});
  selhatNahlas(ctx, identity, 'avp-portal: číselník uložen, ale návrhy vazeb identity selhaly');
  return { cards: cards.length, tanks: tanks.length, chips: chips.length, identity };
}

/**
 * Výdej paliva. Inkrementálně podle `serverSyncTime` (čas ZÁPISU na serveru, ne
 * čerpání — stojany se synchronizují se zpožděním). Kurzor = nejpozdější
 * `serverSyncTime`, který jsme VIDĚLI (ne „teď"), takže záznam zapsaný těsně
 * po dotazu se nepřeskočí. Ukládají se všechny verze i skryté/odstraněné.
 */
export async function syncFuelings(
  ctx: Ctx,
): Promise<{ fetched: number; written: number; cursor: string; projection: unknown }> {
  const client = clientFor(ctx);
  const session = await signIn(ctx, client);
  const since = ((await ctx.kv.get(KV_FUELING_CURSOR)) as string | null) ?? daysAgoIso(num(ctx, 'backfillDays', 7));
  const until = new Date().toISOString();
  const rows = await client.listAll<AvpFueling>(
    session,
    'fuelings',
    {
      filters: { serverSyncTime: `${since}...${until}` },
      only: ['id', 'uid', 'time', 'liters', 'compensatedLiters', 'duration', 'unitPrice', 'exciseTax', 'vat',
        'parentId', 'hidden', 'removed', 'tankId', 'avpId', 'nozzleId', 'driverId', 'vehicleId',
        'vehicleChip', 'driverChip', 'serverSyncTime'],
    },
    num(ctx, 'pageSize', 2000),
  );
  const radky = neprazdne(rows.map(mapFueling));
  const written = await zapsat(ctx, KIND.fueling, 'series', radky);
  const cursor = nejpozdeji(rows.map((r) => r.serverSyncTime), since);
  await ctx.kv.set(KV_FUELING_CURSOR, cursor);
  ctx.log('info', 'avp-portal: výdej zapsán', { fetched: rows.length, written, since, cursor });
  // Výdeje → události 'fueling' na dvojčatech vozidel (avp_project_fuelings).
  // Běží i bez nových výdejů: vazba potvrzená od minula zpřístupní čekající.
  const projection = await vedlejsiKrok(ctx, 'avp_project_fuelings', { p_okno_min: num(ctx, 'projectionWindowMin', 180) });
  selhatNahlas(ctx, projection, 'avp-portal: výdej uložen, ale projekce na dvojčata selhala');
  return { fetched: rows.length, written, cursor, projection };
}

/** Návozy do nádrží a denní uzávěrky — kurzor s překryvem (viz TANK_OVERLAP_MS). */
export async function syncTanks(ctx: Ctx): Promise<{ refills: number; registers: number; cursor: string }> {
  const client = clientFor(ctx);
  const session = await signIn(ctx, client);
  const stored = (await ctx.kv.get(KV_TANK_CURSOR)) as string | null;
  const since = stored
    ? new Date(Date.parse(stored) - TANK_OVERLAP_MS).toISOString()
    : daysAgoIso(num(ctx, 'backfillDays', 7));
  const refills = neprazdne((await client.listAll<AvpTankRefill>(session, 'tank-refills', {
    filters: { time: `${since}...` },
    only: ['id', 'uid', 'time', 'amount', 'type', 'tankId'],
  }, num(ctx, 'pageSize', 2000))).map(mapRefill));
  const registers = neprazdne((await client.listAll<AvpTankRegister>(session, 'tank-registers', {
    filters: { time: `${since}...` },
    only: ['id', 'uid', 'time', 'tankId', 'calculatedTankAmount', 'dispendedAmount', 'refillAmount', 'correctedAmount'],
  }, num(ctx, 'pageSize', 2000))).map(mapRegister));
  await zapsat(ctx, KIND.tankRefill, 'series', refills);
  await zapsat(ctx, KIND.tankRegister, 'series', registers);
  const cursor = nejpozdeji([...refills, ...registers].map((r) => r.occurredAt), stored ?? since);
  await ctx.kv.set(KV_TANK_CURSOR, cursor);
  ctx.log('info', 'avp-portal: nádrže zapsány', { refills: refills.length, registers: registers.length, since, cursor });
  return { refills: refills.length, registers: registers.length, cursor };
}

// ── sandbox entry ────────────────────────────────────────────────────────────

export async function init(ctx: Ctx): Promise<void> {
  const fleetCron = str(ctx, 'fleetSyncCron', '0 3 * * *');
  const fuelingCron = str(ctx, 'fuelingSyncCron', '*/15 * * * *');
  const tankCron = str(ctx, 'tankSyncCron', '20 3 * * *');
  ctx.schedule(fleetCron, 'cron.sync_fleet');
  ctx.schedule(fuelingCron, 'cron.sync_fuelings');
  ctx.schedule(tankCron, 'cron.sync_tanks');
  ctx.log('info', 'avp-portal ready', { fleetCron, fuelingCron, tankCron });
}

export async function handle(ctx: Ctx, capability: string): Promise<unknown> {
  switch (capability) {
    case 'cron.sync_fleet': return await syncFleet(ctx);
    case 'cron.sync_fuelings': return await syncFuelings(ctx);
    case 'cron.sync_tanks': return await syncTanks(ctx);
    default:
      ctx.log('warn', 'unknown capability requested', { capability });
      return { error: 'unknown_capability', capability };
  }
}

export async function dispose(ctx: Ctx): Promise<void> {
  ctx.log('info', 'avp-portal disposed', { tenant: ctx.tenant.id });
}
