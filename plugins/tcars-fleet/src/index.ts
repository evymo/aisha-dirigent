/**
 * T-cars Fleet — data_source plugin (ingest connector).
 *
 * T-cars is a supplier of IoT fleet information: vehicles, people, groups and
 * a journey log, read over its SOAP WebService v2. It is a PLUGIN rather than
 * a service because a deployment with no T-cars contract should carry neither
 * the integration, nor its outbound allowlist, nor its credentials — and
 * because an optional service that stays an npm workspace member is only
 * optional at DEPLOY time: it still has to resolve at BUILD time for everyone.
 * (That is not theory: `npm ci` broke on main until svc-tcars was pasted into
 * the lock file. Twice, by two sessions, each fixing the symptom.)
 *
 * Spine: source_spec → materialize_data_source → agent_knowledge_sources →
 * source-broker plugin host. Same one Eurowag rides. What differs per vendor
 * is transport (SOAP rpc/encoded vs REST), parsing, and identity signals —
 * never the shape of what gets stored.
 *
 * Direction: reads the vendor, writes onto the RAW signal lane. It derives
 * nothing; turning a journey row into "a shift happened" belongs to the
 * evaluator one layer up.
 *
 * Everything reaches the outside world through ctx.fetch, so the sandbox's
 * network allowlist (see manifest) is the real boundary — this module cannot
 * widen it.
 *
 * ⚠️ UNVERIFIED AGAINST A LIVE SYSTEM. The response shapes below are
 * best-effort from `Webservices_Tcars.docx`; no live WSDL or account has ever
 * answered them (the TODO carried over from svc-tcars). The mappers return
 * null on anything unrecognised rather than guessing, so a wrong assumption
 * surfaces as "0 records mapped", not as fabricated rows.
 *
 * @module
 */
import { createTcarsClient, type TcarsCredentials } from "./tc-client.js";
import { mapVozidlo, mapOsoba, mapSkupina, mapJizda, dedupeById } from "./mappers.js";

const KV_LAST_CODEBOOK_SYNC = "tcars:last-codebook-sync";
const KV_LAST_RIDE_SYNC = "tcars:last-ride-sync";
const KV_LAST_RIDE_RECONCILE = "tcars:last-ride-reconcile";

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

function str(ctx: Ctx, k: string, fallback = ""): string {
  const v = ctx.config[k];
  return typeof v === "string" ? v : fallback;
}

function num(ctx: Ctx, k: string, fallback: number): number {
  const v = ctx.config[k];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Courtesy toward someone else's production service — not our own throttling. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function credsFor(ctx: Ctx): TcarsCredentials {
  return {
    cisloSmlouvy: str(ctx, "cisloSmlouvy"),
    jmeno: str(ctx, "jmeno"),
    heslo: str(ctx, "heslo"),
  };
}

function clientFor(ctx: Ctx) {
  return createTcarsClient({
    url: str(ctx, "apiUrl", "https://webservice.t-cars.cz/v2/index.php"),
    timeoutMs: 20_000,
    fetchImpl: (url, init) => ctx.fetch(url, init),
  });
}

/** ISO instant N days back — the ride window when no cursor exists yet. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Codebooks (vehicles, people, groups) are slow-moving reference data, not a
 * stream: a daily pass is enough, and each mapper drops rows it cannot read
 * rather than inventing them.
 */
async function syncCodebooks(
  ctx: Ctx,
): Promise<{ vehicles: number; drivers: number; groups: number; identity: unknown }> {
  const client = clientFor(ctx);
  const creds = credsFor(ctx);

  const vehicles = (await client.vozidlaSeznam(creds, { activeOnly: true })).map(mapVozidlo).filter(Boolean);
  const drivers = (await client.osobySeznam(creds, { activeOnly: true })).map(mapOsoba).filter(Boolean);
  const groups = (await client.skupinySeznam(creds, { activeOnly: true })).map(mapSkupina).filter(Boolean);

  if (vehicles.length) await ctx.rpc("tc_upsert_vehicles_audited", { p_vehicles: vehicles });
  if (drivers.length) await ctx.rpc("tc_upsert_drivers_audited", { p_drivers: drivers });
  if (groups.length) await ctx.rpc("tc_upsert_groups_audited", { p_groups: groups });

  await ctx.kv.set(KV_LAST_CODEBOOK_SYNC, new Date().toISOString());
  const counts = { vehicles: vehicles.length, drivers: drivers.length, groups: groups.length };
  ctx.log("info", "tcars codebooks synced", counts);

  // Fresh codebook = fresh evidence for identity. The platform matches it
  // against what other sources already say about the same vehicle/person and
  // only PROPOSES bindings; a human confirms them. Nothing here creates a twin.
  const identity = await proposeIdentity(ctx);
  failLoudly(ctx, identity, "tcars: číselník uložen, ale návrhy vazeb identity selhaly");
  return { ...counts, identity };
}

/**
 * A side step (identity proposals, projection onto twins) must not undo the
 * sync — data and cursor are already stored when it runs — but it must not
 * stay silent either: a swallowed failure would report the run as healthy and
 * hide the defect. So the run ends FAILED with a readable message; the
 * platform records it as an error event (register_plugin_event → the source
 * health block in admin) and the scheduler simply plans the next run.
 */
function failLoudly(ctx: Ctx, step: unknown, what: string): void {
  const error = (step as { error?: unknown } | null)?.error;
  if (typeof error !== "string") return;
  const message = `${what}: ${error}`;
  ctx.log("error", message);
  throw new Error(message);
}

/**
 * Identity proposals run after the codebook is stored; a failure is returned,
 * not thrown, so nothing already stored is lost — failLoudly then ends the run
 * as failed. Retried with the next codebook run.
 */
async function proposeIdentity(ctx: Ctx): Promise<unknown> {
  try {
    const res = await ctx.rpc("tc_propose_identity", {});
    ctx.log("info", "tcars identity proposals", { result: res });
    return res;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Stored rides → trip events on the vehicle twins. Also runs when nothing new
 * arrived: a binding confirmed since the last tick makes rides that were
 * waiting for it projectable. A failure is returned, not thrown: the raw rides
 * and the cursor stay stored, the next tick re-offers every not-yet-projected
 * ride, and failLoudly still ends this run as failed.
 */
async function projectRides(ctx: Ctx): Promise<unknown> {
  try {
    const res = await ctx.rpc("tc_project_rides", { p_okno_min: num(ctx, "projectionWindowMin", 180) });
    ctx.log("info", "tcars rides projected onto twins", { result: res });
    return res;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Where the next journey-log window starts. The vendor edits rides after the
 * fact (private/business, corrected distances), so re-reading only from the
 * cursor would freeze the first version forever. Two overlaps, because the
 * cost is per VEHICLE CALL, not per row: a short one on every tick (catches a
 * ride that was still open), and a long one once a day (catches late edits).
 * The re-read rows are upserts, so overlap costs bandwidth, never duplicates.
 */
async function rideWindow(ctx: Ctx, now: number): Promise<{ from: string; reconcile: boolean }> {
  const backfill = { from: daysAgo(num(ctx, "rideBackfillDays", 30)), reconcile: true };
  const cursor = await ctx.kv.get(KV_LAST_RIDE_SYNC);
  if (typeof cursor !== "string") return backfill;
  const cursorAt = Date.parse(cursor);
  if (!Number.isFinite(cursorAt)) {
    // An unreadable cursor must not become "read nothing": re-reading the
    // backfill window is idempotent and bounded, skipping it would lose rides.
    ctx.log("warn", "tcars ride cursor unreadable — re-reading the backfill window", { cursor });
    return backfill;
  }
  const lastReconcile = Date.parse(String((await ctx.kv.get(KV_LAST_RIDE_RECONCILE)) ?? ""));
  const reconcile =
    !Number.isFinite(lastReconcile) || now - lastReconcile >= num(ctx, "rideReconcileEveryHours", 20) * 3_600_000;
  const overlapHours = reconcile ? num(ctx, "rideReconcileOverlapHours", 48) : num(ctx, "rideOverlapHours", 2);
  return { from: new Date(Math.min(cursorAt, now) - overlapHours * 3_600_000).toISOString(), reconcile };
}

/**
 * The journey log is per-vehicle, so the vehicle codebook is the work list.
 * The cursor is stored, not recomputed: re-reading the whole history every
 * night would multiply calls by the fleet size for rows we already hold.
 */
async function syncRides(ctx: Ctx): Promise<{
  vehicles: number;
  rides: number;
  failed: number;
  reconcile: boolean;
  projection: unknown;
}> {
  const client = clientFor(ctx);
  const creds = credsFor(ctx);

  const now = Date.now();
  const { from, reconcile } = await rideWindow(ctx, now);
  const to = new Date(now).toISOString();

  const vehicles = (await client.vozidlaSeznam(creds, { activeOnly: true })).map(mapVozidlo).filter(Boolean);

  // One vendor call per vehicle, so the fleet size IS the request count. Two
  // guards, both borrowed from the Webdispečink download script that already
  // survived a real fleet: a pause between calls, and a hard ceiling so a
  // grown fleet (or a misread cursor) cannot turn one tick into hundreds of
  // requests against someone else's production system.
  const pauseMs = num(ctx, "ridePauseMs", 200);
  const callBudget = num(ctx, "rideCallBudget", 0); // 0 = no ceiling

  let total = 0;
  let failed = 0;
  let calls = 0;
  let budgetExhausted = false;

  for (const vehicle of vehicles) {
    if (callBudget > 0 && calls >= callBudget) {
      budgetExhausted = true;
      ctx.log("warn", "tcars ride budget exhausted — window stays open", { callBudget, done: calls });
      break;
    }
    const id = vehicle!.tc_vehicle_id;
    // Per-vehicle isolation: one unreadable journey log used to abort the whole
    // run (the loop had no catch), so every remaining vehicle was skipped AND
    // the cursor below never moved — a single bad row stalled the connector.
    try {
      const book = await client.knihaJizdVozidlo(creds, id, from, to);
      calls++;
      const rides = dedupeById(
        book.jizdy.map((j) => mapJizda(j, id)).filter(Boolean) as Array<{ tc_ride_id: number }>,
        (r) => r.tc_ride_id,
      );
      if (rides.length) {
        await ctx.rpc("tc_upsert_rides_audited", { p_rides: rides });
        total += rides.length;
      }
    } catch (err) {
      failed++;
      calls++;
      ctx.log("warn", "tcars vehicle journey log failed — continuing", {
        vehicle: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (pauseMs > 0) await sleep(pauseMs);
  }

  // The cursor is a claim that everything up to `to` is stored. A vehicle that
  // failed (or was never reached on a spent budget) has no rows for this
  // window, so advancing anyway would skip them for good. Holding the cursor
  // back re-reads a window we already have — cheap — instead of losing data.
  if (failed === 0 && !budgetExhausted) {
    await ctx.kv.set(KV_LAST_RIDE_SYNC, to);
    if (reconcile) await ctx.kv.set(KV_LAST_RIDE_RECONCILE, to);
  } else {
    ctx.log("warn", "tcars ride cursor held back — next run retries this window", {
      from,
      failed,
      budgetExhausted,
    });
  }

  ctx.log("info", "tcars rides synced", { vehicles: vehicles.length, rides: total, failed, from, to, reconcile });
  const projection = await projectRides(ctx);
  failLoudly(ctx, projection, "tcars: jízdy uloženy, ale projekce na dvojčata selhala");
  return { vehicles: vehicles.length, rides: total, failed, reconcile, projection };
}

export async function init(ctx: Ctx): Promise<void> {
  ctx.log("info", "tcars-fleet initializing", { version: ctx.plugin.version, tenant: ctx.tenant.id });

  const codebookCron = str(ctx, "codebookSyncCron", "0 3 * * *");
  const rideCron = str(ctx, "rideSyncCron", "20 5-20 * * *");
  ctx.schedule(codebookCron, "cron.sync_codebooks");
  ctx.schedule(rideCron, "cron.sync_rides");

  ctx.log("info", "tcars-fleet ready", { codebookCron, rideCron });
}

export async function handle(ctx: Ctx, capability: string): Promise<unknown> {
  switch (capability) {
    case "cron.sync_codebooks": return await syncCodebooks(ctx);
    case "cron.sync_rides": return await syncRides(ctx);
    default:
      ctx.log("warn", "unknown capability requested", { capability });
      return { error: "unknown_capability", capability };
  }
}

export async function dispose(ctx: Ctx): Promise<void> {
  ctx.log("info", "tcars-fleet disposed", { tenant: ctx.tenant.id });
}
