/**
 * Periodic sync scheduler — runs the source→aisha drain internally on a fixed
 * interval.
 *
 * MULTI-SOURCE (ENT-01): each tick ENUMERATES the approved, active federated
 * sources via the `audience_list_approved_sources` RPC and syncs EVERY returned
 * source per-source. There is NO hardcoded single source: upstream ships no real
 * source (the loop is a correct no-op with zero approved sources), and forks
 * register their own sources through the onboarding contract. Each source row
 * carries its own endpoint + credential REFERENCE, so the broker builds one
 * per-source connection, keeps a per-source cursor + circuit breaker, and tags
 * every upsert / sync-state write with that source's slug.
 *
 * Design:
 *   - First tick: at boot — see start()
 *   - Subsequent ticks: every config.syncIntervalMs
 *   - Per source, on failure: log + record failure in audience_broker_sync_state
 *     + back off that source's polling via its circuit breaker if too many
 *     consecutive failures. One bad source never halts the drain of the others.
 *   - Disable: set `SOURCE_SYNC_INTERVAL_MS=0`
 *
 * Persistence (P1 hardening):
 *   - Cursor `lastSyncAt` persisted per source to audience_broker_sync_state
 *   - The first time a source is seen, the scheduler restores last_success_at
 *     and resumes from there — survives container restart with no 24h backfill
 *
 * Circuit breaker (per source):
 *   - After N consecutive failures for a source, that source is skipped for a
 *     back-off window of ticks (so we stop hammering a down source) — the other
 *     sources keep syncing every tick.
 *   - Any success for a source resets it to baseline.
 *
 * Concurrency:
 *   - `inflight` mutex prevents overlapping ticks (same logical broker)
 *   - For horizontal scale, use advisory lock or external scheduler
 */

import type { SourceRegistry } from './adapters/source-registry.js';
import type { FastifyBaseLogger } from 'fastify';
import { errMessage } from './errors.js';
import { Client as PgClient } from 'pg';
import { SourcePgClient } from './clients/pg-readonly-driver.js';
import type { SourceBrokerConfig } from './config.js';
import { summarizeDrift, type DriftReport } from './contracts/drift-canary.js';
import { syncSourceCatalogs, type CatalogPg } from './clients/catalog-lane.js';
import { navrhniShodyIdentit, type MatchPg } from './clients/identity-match-lane.js';
import { udrzbaFederace, type Odhlasovac, type VysledekUdrzby } from './lib/udrzba-federace.js';
import { jakoSluzba } from './lib/trezor-relaci.js';
import type { KlicTrezoru } from './lib/trezor-sifra.js';

/**
 * Thrown when the source contract has HARD drift (missing table/column). Carries
 * the report so the scheduler can record it. Distinct type lets the catch path
 * tell "schema drifted" apart from "query/network failed" — different remedies.
 */
export class ContractDriftError extends Error {
  constructor(public readonly report: DriftReport) {
    super(summarizeDrift(report));
    this.name = 'ContractDriftError';
  }
}

export interface SchedulerHandle {
  start(): Promise<void>;
  stop(): void;
  triggerNow(): Promise<SyncStats>;
  lastResult(): SyncResult | null;
  syncState(): SyncStateSummary | null;
  /** Jeden tik údržby trezoru relací federovaného zdroje (ADR-004) — pro testy a ruční spuštění. */
  udrzbaNow?(): Promise<VysledekUdrzby>;
}

interface SyncStats {
  recentActiveFetched: number;
  upserted: number;
  /** period-statistic rows (topics + events, last STATS_MONTHS months) upserted this tick */
  statsUpserted: number;
  /** source-catalog rows (listCatalog → audience_sync_source_catalog) upserted this tick */
  catalogsUpserted: number;
  /** identity matches proposed this tick — DOPORUČENÍ pro člověka, ne vazby */
  matchesProposed: number;
  errors: number;
  durationMs: number;
}

interface SyncResult {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  errorMessage?: string;
  stats: SyncStats;
  // How many approved sources this tick enumerated + how many it actually drained.
  sourcesEnumerated: number;
  sourcesSynced: number;
}

/** Per-source observability slice, surfaced in the aggregate status. */
interface SourceStateSummary {
  sourceSlug: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  totalSyncs: number;
  totalFailures: number;
  circuitOpen: boolean;
  contractOk: boolean;
  lastDriftSummary: string | null;
  lastFetchedCount: number | null;
  rowDeltaAnomaly: boolean;
}

interface SyncStateSummary {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  totalSyncs: number;
  totalFailures: number;
  circuitOpen: boolean;
  effectiveIntervalMs: number;
  // Seam observability — the integration boundary is where failures hide
  // because both sides think they're fine. Surface drift + row-delta here.
  contractOk: boolean;            // last canary: no hard drift (all sources)
  lastDriftSummary: string | null; // human summary of last drift, if any
  lastFetchedCount: number | null; // rows fetched last sync (row-delta anomaly)
  rowDeltaAnomaly: boolean;        // prev>0 but this=0 with no drift (suspicious)
  // Multi-source detail — the aggregate above is a roll-up over these.
  sourceCount: number;
  perSource: SourceStateSummary[];
}

/**
 * One approved source as returned by public.audience_list_approved_sources.
 * The broker never receives the raw secret — only auth_secret_ref, an env-var
 * NAME resolved via the 12-factor convention below.
 */
interface ApprovedSource {
  sourceId: string;
  storyId: string;
  sourceSlug: string;
  namespace: string | null;
  dataSensitivity: string | null;
  endpointUrl: string | null;
  authSecretRef: string | null;
  lastSyncAt: string | null;
}

/** Mutable per-source runtime state (cursor + circuit + observability). */
interface SourceRuntimeState {
  slug: string;
  restored: boolean;              // cursor restored from aisha-db yet?
  lastSyncAt: Date | null;
  consecutiveFailures: number;
  totalSyncs: number;
  totalFailures: number;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastDrift: DriftReport | null;
  lastFetchedCount: number | null;
  rowDeltaAnomaly: boolean;
  // Circuit breaker: ticks to skip before retrying this source after it tripped.
  circuitBackoffRemaining: number;
}

// Circuit breaker config — could move to env vars if tuning needed.
/** How many calendar months of period statistics each tick re-syncs (current + N-1 back). */
const STATS_MONTHS = 3;
/** ['YYYY-MM', …] for the current month and the (n-1) preceding ones, newest first. */
function lastMonths(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
export { lastMonths };
const CIRCUIT_TRIP_THRESHOLD = 5;   // consecutive failures to open a source's circuit
const CIRCUIT_BACKOFF_FACTOR = 4;   // ticks to skip a tripped source before retry

export function createScheduler(
  config: SourceBrokerConfig,
  logger: FastifyBaseLogger,
  registry?: Pick<SourceRegistry, 'getForStory'>,
  federace?: { odhlasovace: ReadonlyMap<string, Odhlasovac> }
): SchedulerHandle {
  let timer: NodeJS.Timeout | null = null;
  let udrzbaTimer: NodeJS.Timeout | null = null;
  let udrzbaInflight = false;
  const odhlasovace: ReadonlyMap<string, Odhlasovac> = federace?.odhlasovace ?? new Map();
  // Klíč trezoru: v nasazení ho `loadConfig` vyžaduje (start bez něj spadne). Bez něj jsou
  // jen ručně sestavené konfigurace testů — údržba pak jen uklízí, odhlašovat neumí.
  const klicTrezoru: KlicTrezoru | null = config.federationVaultKey ?? null;
  let inflight = false;
  let lastResultCache: SyncResult | null = null;

  // Per-source state, keyed by source_slug. Persists across ticks so cursors +
  // circuit state accumulate; new sources are added lazily on first encounter.
  const states = new Map<string, SourceRuntimeState>();

  // Hard ceiling on a single tick (drains ALL sources). Prevents one bad tick
  // from blocking all subsequent ticks. If exceeded, the tick is force-cancelled
  // and inflight reset.
  const RUN_TIMEOUT_MS = 120_000;

  // Bi-temporal cursor overlap: the cursor advances on ingestion time but
  // filters on the source's event time (last_activity). An update that arrives
  // with a backdated last_activity between syncs would be missed by a strict
  // cursor. Re-scanning a small overlap window catches these; the idempotent
  // upsert absorbs the redundant rows harmlessly.
  const CURSOR_OVERLAP_MS = 5 * 60_000; // 5 minutes

  function stateFor(slug: string): SourceRuntimeState {
    let s = states.get(slug);
    if (!s) {
      s = {
        slug,
        restored: false,
        lastSyncAt: null,
        consecutiveFailures: 0,
        totalSyncs: 0,
        totalFailures: 0,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastDrift: null,
        lastFetchedCount: null,
        rowDeltaAnomaly: false,
        circuitBackoffRemaining: 0,
      };
      states.set(slug, s);
    }
    return s;
  }

  /**
   * Resolve a per-source Postgres connection string from an approved-source row.
   *
   * 12-factor credential convention (NO secret vault): the row carries a
   * credential REFERENCE (`auth_secret_ref`), the NAME of an environment
   * variable — never the secret itself. That env var holds EITHER a full DSN
   * (which wins outright, carrying host + credentials) OR just the password,
   * which is injected into the row's `endpoint_url`. Fail loud if the reference
   * or the endpoint is missing/unset so a misconfigured source is skipped, not
   * silently connected to the wrong place.
   */
  function resolveSourceConnectionString(src: ApprovedSource): string {
    if (!src.endpointUrl) {
      throw new Error(`source '${src.sourceSlug}': no endpoint_url binding`);
    }
    if (!src.authSecretRef) {
      throw new Error(`source '${src.sourceSlug}': no auth_secret_ref credential reference`);
    }
    // ⛔ BINDING DEKLARUJE SCHÉMA `env:NÁZEV` (instanční seed:
    // auth_secret_ref='env:SOURCE_PG_URL'), resolver ale sahal na
    // process.env["env:SOURCE_PG_URL"] — undefined → throw. Ten throw navíc
    // spolkl agg catch v scheduleru s komentářem „syncOneSource už zalogoval",
    // takže tick končil errors=1 BEZE STOPY (naměřeno 2026-08-30: 31 ms,
    // žádný log, žádný persist). Prefix se proto odloupne; holé jméno
    // zůstává podporované.
    const envName = src.authSecretRef.replace(/^env:/, '');
    const secret = process.env[envName];
    if (!secret) {
      throw new Error(
        `source '${src.sourceSlug}': credential env var '${envName}' is not set (ref '${src.authSecretRef}')`
      );
    }
    if (/^postgres(ql)?:\/\//i.test(secret)) {
      return secret; // full DSN — carries its own host + credentials
    }
    const url = new URL(src.endpointUrl);
    url.password = secret;
    return url.toString();
  }

  /**
   * Enumerate the approved, active federated sources over the story spine. The
   * trusted broker passes NULL to drain EVERY approved source (all namespaces).
   * service_role connection (config.postgresUrl) — the RPC guards on
   * is_service_role()/is_admin_or_staff() and returns only credential references.
   */
  async function listApprovedSources(aishaPg: PgClient): Promise<ApprovedSource[]> {
    const res = await aishaPg.query<{
      source_id: string;
      story_id: string;
      source_slug: string;
      namespace: string | null;
      data_sensitivity: string | null;
      endpoint_url: string | null;
      auth_secret_ref: string | null;
      last_sync_at: string | null;
    }>(
      `SELECT source_id, story_id, source_slug, namespace, data_sensitivity,
              endpoint_url, auth_secret_ref, last_sync_at
         FROM public.audience_list_approved_sources($1::text)`,
      [null]
    );
    return res.rows.map((r) => ({
      sourceId: r.source_id,
      storyId: r.story_id,
      sourceSlug: r.source_slug,
      namespace: r.namespace,
      dataSensitivity: r.data_sensitivity,
      endpointUrl: r.endpoint_url,
      authSecretRef: r.auth_secret_ref,
      lastSyncAt: r.last_sync_at,
    }));
  }

  /**
   * Restore a source's cursor from aisha-db the first time it is seen.
   * Best-effort: if the row is absent or the query fails, the source cold-starts
   * from the 24h fallback cursor (same as before persistence).
   */
  async function restoreCursor(aishaPg: PgClient, state: SourceRuntimeState): Promise<void> {
    if (state.restored) return;
    state.restored = true; // attempt only once regardless of outcome
    try {
      const res = await aishaPg.query<{
        last_success_at: string | null;
        consecutive_failures: number;
        total_syncs: string;
        total_failures: string;
        last_error_at: string | null;
      }>(
        `SELECT last_success_at, consecutive_failures, total_syncs, total_failures, last_error_at
           FROM public.audience_broker_sync_state
          WHERE source_slug = $1`,
        [state.slug]
      );
      if (res.rowCount && res.rowCount > 0) {
        const r = res.rows[0];
        if (r.last_success_at) {
          state.lastSyncAt = new Date(r.last_success_at);
          state.lastSuccessAt = state.lastSyncAt;
        }
        if (r.last_error_at) state.lastErrorAt = new Date(r.last_error_at);
        state.consecutiveFailures = r.consecutive_failures ?? 0;
        state.totalSyncs = Number(r.total_syncs ?? 0);
        state.totalFailures = Number(r.total_failures ?? 0);
        logger.info(
          {
            source: state.slug,
            lastSuccessAt: state.lastSyncAt?.toISOString(),
            consecutiveFailures: state.consecutiveFailures,
          },
          'scheduler: cursor restored from aisha-db'
        );
      } else {
        logger.info(
          { source: state.slug },
          'scheduler: no prior sync state in aisha-db; cold start (24h cursor)'
        );
      }
    } catch (err) {
      logger.warn(
        { source: state.slug, err: errMessage(err) },
        'scheduler: failed to restore cursor; using 24h fallback'
      );
    }
  }

  /**
   * Persist a source's tick result to aisha-db via SECURITY DEFINER RPC. The
   * broker writer role has no UPDATE grant on the table, so this RPC is the only
   * path. Reuses the tick's aisha-db connection. Non-fatal on failure.
   */
  async function persistSyncResult(
    aishaPg: PgClient,
    sourceSlug: string,
    startedAt: Date,
    finishedAt: Date,
    ok: boolean,
    errorMessage: string | undefined,
    stats: SyncStats
  ): Promise<void> {
    try {
      await aishaPg.query(
        `SELECT public.audience_broker_record_sync(
           $1::text, $2::timestamptz, $3::timestamptz, $4::boolean,
           $5::text, $6::integer, $7::integer, $8::jsonb
         )`,
        [
          sourceSlug,
          startedAt.toISOString(),
          finishedAt.toISOString(),
          ok,
          errorMessage ?? null,
          stats.recentActiveFetched,
          stats.upserted,
          JSON.stringify({ errors: stats.errors, durationMs: stats.durationMs }),
        ]
      );
    } catch (err) {
      // Persistence failure is non-fatal — log + continue. We still have
      // in-memory state for this process lifetime.
      logger.error(
        { source: sourceSlug, err: errMessage(err) },
        'scheduler: failed to persist sync state'
      );
    }
  }

  /**
   * Drain ONE approved source. Builds a per-source connection from the row's
   * endpoint + resolved credential, verifies the source contract, advances that
   * source's own cursor, and tags every upsert / sync-state write with the
   * source's slug. Returns the source's stats; throws on failure so the caller
   * can count it — the caller catches so one bad source never halts the loop.
   */
  async function syncOneSource(
    aishaPg: PgClient,
    src: ApprovedSource,
    state: SourceRuntimeState
  ): Promise<SyncStats> {
    const startedAt = new Date();
    const stats: SyncStats = { recentActiveFetched: 0, upserted: 0, statsUpserted: 0, catalogsUpserted: 0, matchesProposed: 0, errors: 0, durationMs: 0 };

    // Resolve BEFORE opening any connection so a credential/endpoint
    // misconfiguration fails loud without a dangling client.
    const connectionString = resolveSourceConnectionString(src);
    const source = new SourcePgClient(config, connectionString);

    try {
      await source.connect();

      // ── ACL drift canary — verify source contract BEFORE reading ──────────
      // If the source schema drifted (renamed/dropped a column we depend on),
      // refuse to sync THIS source: don't advance its cursor, don't write zeros
      // over good aisha data. Fail loud AT THE SEAM. Soft (type) drift warns.
      const drift = await source.verifyContract(startedAt.toISOString());
      state.lastDrift = drift;
      if (drift.hardDrift) {
        throw new ContractDriftError(drift);
      }
      if (drift.softDrift) {
        logger.warn(
          { source: src.sourceSlug, drift: summarizeDrift(drift) },
          'scheduler: soft contract drift (proceeding)'
        );
      }

      // Per-source cursor with overlap window (bi-temporal correctness). On cold
      // start, fall back to 24h ago. Otherwise re-scan from lastSyncAt - overlap.
      const since = state.lastSyncAt
        ? new Date(state.lastSyncAt.getTime() - CURSOR_OVERLAP_MS)
        : new Date(Date.now() - 86_400_000);
      const activeUsers = await source.getRecentActiveUserIds(since, 1000);
      stats.recentActiveFetched = activeUsers.length;

      // Row-delta anomaly: previous sync of this source saw users but this one
      // sees zero with no drift → suspicious (cursor bug, upstream emptying,
      // silent partial drift). Flag for observability; don't fail (could be
      // legitimate).
      state.rowDeltaAnomaly =
        state.lastFetchedCount !== null &&
        state.lastFetchedCount > 0 &&
        activeUsers.length === 0;
      if (state.rowDeltaAnomaly) {
        logger.warn(
          { source: src.sourceSlug, previous: state.lastFetchedCount, current: 0 },
          'scheduler: row-delta anomaly — fetched 0 active users after a non-zero sync'
        );
      }
      state.lastFetchedCount = activeUsers.length;
      // ── Period statistics (topics / events per month) ─────────────────────
      // Goes through the REGISTRY adapter (the fork's plugin), not this generic
      // driver: the SQL is source-specific and must stay out of the fork core
      // (keep-fork-upstream-clean). Feature-detected — a source without
      // listStats simply has no stats, which is not an error. Re-syncs the last
      // STATS_MONTHS months every tick (idempotent upsert), so a topic renamed or
      // a follow added in an earlier month converges without a cursor.
      const adapter = registry?.getForStory(src.storyId);
      const conn = {
        endpointUrl: src.endpointUrl ?? '',
        authMethod: 'pg_dsn',
        authSecretRef: src.authSecretRef,
        dataSensitivity: src.dataSensitivity ?? 'internal',
      };
      if (adapter && typeof adapter.listStats === 'function') {
        for (const month of lastMonths(STATS_MONTHS)) {
          for (const kind of ['topic', 'event'] as const) {
            const rows = await adapter.listStats(kind, conn, { month });
            for (const row of rows) {
              await aishaPg.query(
                `SELECT public.audience_upsert_source_stat($1::text, $2::text, $3::text, $4::jsonb, $5::text)`,
                [kind, month, row.externalId, JSON.stringify(row), src.sourceSlug]
              );
              stats.statsUpserted += 1;
            }
          }
        }
      }

      // ── Katalogy zdroje (celé množiny záznamů pro plochu) ────────────────
      // Stejně jako statistiky přes ADAPTÉR (znalost zdroje patří instanci).
      // Chyba katalogu se počítá do errors, ale zdroj neshodí: statistiky
      // a zapojení z téhož taktu jsou pořád dobrá data.
      if (adapter) {
        const cat = await syncSourceCatalogs(adapter, conn, aishaPg as unknown as CatalogPg, src.sourceSlug, logger);
        stats.catalogsUpserted += cat.upserted;
        stats.errors += cat.errors;

        // ── Doporučení identit (ingest ↔ účty) ────────────────────────────
        // Jen NÁVRHY do ratifikační fronty; potvrzuje výhradně člověk v kokpitu.
        const shody = await navrhniShodyIdentit(adapter, conn, aishaPg as unknown as MatchPg, src.sourceSlug, logger);
        stats.matchesProposed += shody.proposed;
        stats.errors += shody.errors;
      }

      for (const u of activeUsers) {
        try {
          const engagement = await source.getEngagementForUser(u.userId);
          if (!engagement) continue;

          await aishaPg.query(
            `SELECT public.audience_upsert_user_engagement($1::uuid, $2::jsonb, $3::text)`,
            [
              u.userId,
              JSON.stringify({
                app_accesses_30d: engagement.appAccesses30d,
                app_accesses_90d: engagement.appAccesses90d,
                last_active_at: engagement.lastActivityAt,
                events_created_30d: engagement.eventsCreated30d,
                events_created_90d: engagement.eventsCreated90d,
                posts_created_30d: 0,
                audience_size: engagement.audienceSize,
                audience_growth_30d: engagement.audienceSize > 0
                  ? engagement.uniqueFollowers30d / engagement.audienceSize
                  : 0,
                unique_attendees_30d: engagement.uniqueFollowers30d,
                total_attendance_30d: engagement.totalAttendance30d,
                emails_opened_90d: 0,
                emails_sent_90d: 0,
              }),
              src.sourceSlug,
            ]
          );
          stats.upserted += 1;
        } catch (err) {
          stats.errors += 1;
          logger.error(
            { err, source: src.sourceSlug, userId: u.userId },
            'scheduler: per-user upsert failure'
          );
        }
      }

      state.lastSyncAt = startedAt;
      state.lastSuccessAt = startedAt;
      state.consecutiveFailures = 0; // circuit closes on any success
      state.circuitBackoffRemaining = 0;
      state.totalSyncs += 1;
      stats.durationMs = Date.now() - startedAt.getTime();
      const finishedAt = new Date();
      await persistSyncResult(aishaPg, src.sourceSlug, startedAt, finishedAt, true, undefined, stats);
      logger.info({ source: src.sourceSlug, stats }, 'scheduler: source sync complete');
      return stats;
    } catch (err) {
      stats.durationMs = Date.now() - startedAt.getTime();
      state.consecutiveFailures += 1;
      state.totalSyncs += 1;
      state.totalFailures += 1;
      const finishedAt = new Date();
      state.lastErrorAt = finishedAt;
      await persistSyncResult(
        aishaPg,
        src.sourceSlug,
        startedAt,
        finishedAt,
        false,
        errMessage(err),
        stats
      );
      const circuitTripped = state.consecutiveFailures >= CIRCUIT_TRIP_THRESHOLD;
      if (circuitTripped) {
        // Skip this source for a back-off window of ticks. Other sources keep
        // syncing every tick — one down source doesn't back off the whole loop.
        state.circuitBackoffRemaining = CIRCUIT_BACKOFF_FACTOR;
      }
      logger.error(
        {
          err: errMessage(err),
          source: src.sourceSlug,
          stats,
          consecutiveFailures: state.consecutiveFailures,
          circuitTripped,
        },
        circuitTripped
          ? 'scheduler: source circuit breaker OPEN — backing off this source'
          : 'scheduler: source sync failed'
      );
      throw err;
    } finally {
      await source.disconnect().catch(() => undefined);
    }
  }

  async function runOnceInternal(): Promise<SyncStats> {
    const startedAt = new Date();
    const agg: SyncStats = { recentActiveFetched: 0, upserted: 0, statsUpserted: 0, catalogsUpserted: 0, matchesProposed: 0, errors: 0, durationMs: 0 };
    const aishaPg = new PgClient({
      connectionString: config.postgresUrl,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
      query_timeout: 30_000,
    });

    let sourcesEnumerated = 0;
    let sourcesSynced = 0;
    let tickError: string | undefined;

    try {
      await aishaPg.connect();

      // Sezení se musí PŘEDSTAVIT jako služba, ne spolehnout na databázovou roli.
      //
      // `audience_list_approved_sources()` se ptá `is_service_role() OR
      // is_admin_or_staff()`, a obojí čte JWT claim / GUC `role` — NE roli
      // spojení. Broker se připojuje jako `aisha_admin`, takže guard správně
      // odmítl: „Access denied" (ERRCODE 42501) a tick padl hned na enumeraci,
      // dřív než se vůbec došlo k drop lane. Změřeno 2026-07-30 při prvním
      // ostrém replayi: `set role aisha_admin` → Access denied, `set role
      // service_role` → projde.
      //
      // Týž postup jako v li-driver.ts (řádek ~553), jen o pár set řádků vedle:
      // claims napřed, pak role — jakmile je sezení service_role, nemusí už smět
      // ten GUC nastavit. Obojí je session-scoped a umírá se spojením.
      await aishaPg.query(`SET request.jwt.claims = '{"role":"service_role"}'`);
      await aishaPg.query('SET ROLE service_role');

      const sources = await listApprovedSources(aishaPg);
      sourcesEnumerated = sources.length;

      if (sources.length === 0) {
        // Upstream posture: no approved source registered → correct no-op. We
        // keep ticking so a newly-approved source is picked up automatically.
        logger.info('scheduler: no approved sources to sync (no-op tick)');
      }

      for (const src of sources) {
        const state = stateFor(src.sourceSlug);
        await restoreCursor(aishaPg, state);

        // Per-source circuit back-off: skip a tripped source for a window.
        if (state.circuitBackoffRemaining > 0) {
          state.circuitBackoffRemaining -= 1;
          logger.warn(
            { source: src.sourceSlug, remaining: state.circuitBackoffRemaining },
            'scheduler: skipping source (circuit breaker backing off)'
          );
          continue;
        }

        try {
          const stats = await syncOneSource(aishaPg, src, state);
          sourcesSynced += 1;
          agg.recentActiveFetched += stats.recentActiveFetched;
          agg.upserted += stats.upserted;
          agg.statsUpserted += stats.statsUpserted;
          agg.catalogsUpserted += stats.catalogsUpserted;
          agg.matchesProposed += stats.matchesProposed;
          agg.errors += stats.errors;
        } catch (err) {
          // syncOneSource already logged + recorded + tripped the circuit.
          // Swallow here so ONE bad source never halts the drain of the rest.
          agg.errors += 1;
          void err;
        }
      }

      agg.durationMs = Date.now() - startedAt.getTime();
      const finishedAt = new Date();
      const anyFailure = sourcesEnumerated > 0 && sourcesSynced < sourcesEnumerated;
      lastResultCache = {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        ok: !anyFailure,
        errorMessage: anyFailure ? 'one or more sources failed to sync' : undefined,
        stats: agg,
        sourcesEnumerated,
        sourcesSynced,
      };
      logger.info(
        { stats: agg, sourcesEnumerated, sourcesSynced },
        'scheduler: sync tick complete'
      );
      return agg;
    } catch (err) {
      // Tick-level failure (e.g. enumeration/aisha-db unreachable). Record an
      // aggregate failure; the next tick retries.
      tickError = errMessage(err);
      agg.durationMs = Date.now() - startedAt.getTime();
      const finishedAt = new Date();
      lastResultCache = {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        ok: false,
        errorMessage: tickError,
        stats: agg,
        sourcesEnumerated,
        sourcesSynced,
      };
      logger.error({ err: tickError }, 'scheduler: sync tick failed (enumeration)');
      throw err;
    } finally {
      await aishaPg.end().catch(() => undefined);
    }
  }

  async function runOnce(): Promise<SyncStats> {
    if (inflight) {
      logger.warn('scheduler: skipping tick (previous sync still inflight)');
      return { recentActiveFetched: 0, upserted: 0, statsUpserted: 0, catalogsUpserted: 0, matchesProposed: 0, errors: 0, durationMs: 0 };
    }
    inflight = true;
    try {
      const timeoutPromise = new Promise<SyncStats>((_, reject) =>
        setTimeout(() => reject(new Error(`sync timeout after ${RUN_TIMEOUT_MS}ms`)), RUN_TIMEOUT_MS)
      );
      return await Promise.race([runOnceInternal(), timeoutPromise]);
    } finally {
      inflight = false;
    }
  }

  /**
   * Schedule the next tick. Baseline interval — per-source circuit breakers
   * handle backing off individual down sources, so the global cadence stays
   * fixed (and keeps polling to pick up newly-approved sources).
   */
  function scheduleNextTick(): void {
    if (config.syncIntervalMs <= 0) return; // disabled
    timer = setTimeout(() => {
      runOnce()
        .catch(() => { /* errors logged inside runOnce */ })
        .finally(() => scheduleNextTick());
    }, config.syncIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  // ── Údržba trezoru relací federovaného zdroje (ADR-004) ──────────────────────
  // Vlastní časovač v témže plánovači: úklid prošlých nonce a limitů + fronta odhlášení
  // u zdroje. Víc replik se nezdvojí — udrzbaFederace bere pojmenovaný advisory lock.
  async function udrzbaNow(): Promise<VysledekUdrzby> {
    const nic: VysledekUdrzby = { zamek: false, nonceSmazano: 0, limityUklizeno: 0, odhlaseno: 0, odhlaseniSelhalo: 0 };
    if (udrzbaInflight) return nic;
    udrzbaInflight = true;
    const pg = new PgClient({
      connectionString: config.postgresUrl,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
      query_timeout: 30_000,
    });
    try {
      await pg.connect();
      await jakoSluzba(pg);
      return await udrzbaFederace({ pg, klic: klicTrezoru, odhlasovace, logger });
    } catch (e) {
      logger.warn({ err: errMessage(e) }, 'federace: tik údržby trezoru selhal');
      return nic;
    } finally {
      udrzbaInflight = false;
      await pg.end().catch(() => { /* spojení už je pryč */ });
    }
  }

  function scheduleNextUdrzba(): void {
    // Chybí-li v konfiguraci (ruční/testovací config), údržba NEběží; loadConfig ho nastaví vždy.
    const interval = config.federationMaintenanceIntervalMs ?? 0;
    if (interval <= 0) return;
    udrzbaTimer = setTimeout(() => {
      udrzbaNow().finally(() => scheduleNextUdrzba());
    }, interval);
    if (typeof udrzbaTimer.unref === 'function') udrzbaTimer.unref();
  }

  function anyCircuitOpen(): boolean {
    for (const s of states.values()) {
      if (s.consecutiveFailures >= CIRCUIT_TRIP_THRESHOLD) return true;
    }
    return false;
  }

  return {
    async start(): Promise<void> {
      if (!udrzbaTimer) scheduleNextUdrzba();
      if (timer) return;
      if (config.syncIntervalMs <= 0) {
        logger.info('scheduler: disabled (SOURCE_SYNC_INTERVAL_MS=0)');
        return;
      }
      logger.info(
        { intervalMs: config.syncIntervalMs },
        'scheduler: starting multi-source cron loop'
      );
      scheduleNextTick();
    },

    stop(): void {
      if (udrzbaTimer) {
        clearTimeout(udrzbaTimer);
        udrzbaTimer = null;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
        logger.info('scheduler: stopped');
      }
    },

    async triggerNow(): Promise<SyncStats> {
      return runOnce();
    },

    udrzbaNow,

    lastResult(): SyncResult | null {
      return lastResultCache;
    },

    syncState(): SyncStateSummary | null {
      const perSource: SourceStateSummary[] = [];
      let lastSuccessAt: Date | null = null;
      let lastErrorAt: Date | null = null;
      let maxConsecutiveFailures = 0;
      let totalSyncs = 0;
      let totalFailures = 0;
      let contractOk = true;
      let firstDriftSummary: string | null = null;
      let lastFetchedCount: number | null = null;
      let anyRowDeltaAnomaly = false;

      for (const s of states.values()) {
        const driftSummary =
          s.lastDrift && s.lastDrift.issues.length > 0 ? summarizeDrift(s.lastDrift) : null;
        perSource.push({
          sourceSlug: s.slug,
          lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
          lastErrorAt: s.lastErrorAt?.toISOString() ?? null,
          consecutiveFailures: s.consecutiveFailures,
          totalSyncs: s.totalSyncs,
          totalFailures: s.totalFailures,
          circuitOpen: s.consecutiveFailures >= CIRCUIT_TRIP_THRESHOLD,
          contractOk: s.lastDrift ? !s.lastDrift.hardDrift : true,
          lastDriftSummary: driftSummary,
          lastFetchedCount: s.lastFetchedCount,
          rowDeltaAnomaly: s.rowDeltaAnomaly,
        });

        if (s.lastSuccessAt && (!lastSuccessAt || s.lastSuccessAt > lastSuccessAt)) {
          lastSuccessAt = s.lastSuccessAt;
        }
        if (s.lastErrorAt && (!lastErrorAt || s.lastErrorAt > lastErrorAt)) {
          lastErrorAt = s.lastErrorAt;
        }
        maxConsecutiveFailures = Math.max(maxConsecutiveFailures, s.consecutiveFailures);
        totalSyncs += s.totalSyncs;
        totalFailures += s.totalFailures;
        if (s.lastDrift?.hardDrift) contractOk = false;
        if (!firstDriftSummary && driftSummary) firstDriftSummary = driftSummary;
        if (s.lastFetchedCount !== null) {
          lastFetchedCount = (lastFetchedCount ?? 0) + s.lastFetchedCount;
        }
        if (s.rowDeltaAnomaly) anyRowDeltaAnomaly = true;
      }

      return {
        lastSuccessAt: lastSuccessAt ? (lastSuccessAt as Date).toISOString() : null,
        lastErrorAt: lastErrorAt ? (lastErrorAt as Date).toISOString() : null,
        consecutiveFailures: maxConsecutiveFailures,
        totalSyncs,
        totalFailures,
        circuitOpen: anyCircuitOpen(),
        effectiveIntervalMs: config.syncIntervalMs,
        contractOk,
        lastDriftSummary: firstDriftSummary,
        lastFetchedCount,
        rowDeltaAnomaly: anyRowDeltaAnomaly,
        sourceCount: states.size,
        perSource,
      };
    },
  };
}
