/**
 * source-read.ts — generic, on-demand LIVE source reads over the story spine.
 *
 * The dashboard-freshness path that complements the ~24h batch /sync. It is
 * source-AGNOSTIC: every route dispatches through the registry BY STORY, so each
 * fork plugs in its own adapter (a plugin loaded via svc-plugin-system, or the
 * in-process NullDataSource default) without touching this file. Nothing
 * fork-specific lives here.
 *
 * Per request, in order (see the runtime design):
 *   ① PRINCIPAL guard — requireAdminOrService (who may ASK). Never a client header.
 *   ② Resolve the binding via public.audience_resolve_source_binding(story_id):
 *      endpoint + credential-REF + data_sensitivity + is_approved, from the spine.
 *      unapproved ⇒ 403 (the approve↔read tie #572 left open); no active instance
 *      ⇒ 404 (materialised nowhere); no endpoint binding ⇒ 404.
 *   ③ Dispatch BY STORY: registry.getForStory(storyId) → the fork's adapter, or the
 *      NullDataSource default when none is registered (⇒ 501 not_configured).
 *   ④ Cache-first: serve a fresh cached result; only on miss does the adapter do
 *      one live read, handed the resolved SourceConnection (endpoint + cred ref).
 *   ⑤ Write-through (engagement reads only): a per-user engagement read is written
 *      back to user_engagement_metrics via audience_upsert_user_engagement — mapped
 *      to the RPC's snake_case shape by snapshotToUpsertJson (raw camelCase would
 *      miss every key and zero the row) — so the existing audience_admin_*_v
 *      dashboards see it (no split-brain). KPI (community aggregate) and member
 *      (detail view) reads are cache+audit only: they do not map to a mirror row.
 *   ⑥ Audit every cross-user read into audit_journal (area='source_read'), fired
 *      before the write-through so a failed mirror write never suppresses it.
 *
 * A story with no real adapter resolves to NullDataSource → 501 not_configured
 * (the feature is cleanly OPTIONAL, like a missing LLM key). A configured source
 * whose read fails → 502 fail-loud (no zeros).
 *
 * DB I/O is injected via SourceReadDeps so the route flow is unit-testable in
 * isolation (the production factory createPgSourceReadDeps talks to aisha-db).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Client as PgClient } from 'pg';
import { createAuthGuard } from '../auth-guard.js';
import type { SourceBrokerConfig } from '../config.js';
import type { SourceRegistry } from '../adapters/source-registry.js';
import { SourceNotConfiguredError } from '../adapters/null-data-source.js';
import { TtlCache } from '../lib/ttl-cache.js';
import { snapshotToUpsertJson } from '../lib/engagement-snapshot.js';
import { MemberTier } from '@aisha/audience-types';
import type { StatKind,
  EntityType,
  ScopedEntityResult,
  ActorAggregateSnapshot,
  SourceConnection,
} from '@aisha/audience-types';

// Operator/admin reads carry the Admin tier as the source-side caller scope —
// the PRINCIPAL was already verified admin/staff by requireAdminOrService, so the
// adapter's source-side permission check sees a full-access operator.
const OPERATOR_SCOPE = { userId: 'operator', tier: MemberTier.Admin };

const SOURCE_ENDPOINT_ROLE = 'source_pg_readonly';
/** Freshness window: source activity is hours/days, not sub-second. */
const READ_TTL_MS = 60_000;
/** A story id must be a UUID — it is cast to ::uuid in the resolver RPC. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SourceBinding {
  instance_id: string;
  endpoint_url: string;
  auth_method: string;
  auth_secret_ref: string | null;
  data_sensitivity: string;
  is_approved: boolean;
}

/** Discriminated resolution so the route maps each spine state to a clean code. */
export type BindingResolution =
  | { status: 'ok'; binding: SourceBinding }
  | { status: 'unapproved' }       // instance + binding exist, not yet approved
  | { status: 'unmaterialized' }   // no active story_instance (resolver P0002)
  | { status: 'no_binding' };      // active instance, no endpoint binding row

/** Injectable DB seam — the production impl is createPgSourceReadDeps below. */
export interface SourceReadDeps {
  resolveBinding(storyId: string): Promise<BindingResolution>;
  upsertEngagement(userId: string, snapshot: unknown, sourceSlug: string): Promise<void>;
  auditRead(storyId: string, kind: string, subjectId: string | null): Promise<void>;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** pg-backed SourceReadDeps against aisha-db (config.postgresUrl). */
export function createPgSourceReadDeps(config: SourceBrokerConfig): SourceReadDeps {
  return {
    async resolveBinding(storyId: string): Promise<BindingResolution> {
      const aishaPg = new PgClient({ connectionString: config.postgresUrl });
      try {
        await aishaPg.connect();
        // ⛔ NÁROK PŘED DOTAZEM. `audience_resolve_source_binding` je DEFINER se
        // stráží `is_service_role() OR is_admin_or_staff()`. Broker se připojuje
        // jako `aisha_admin` — ani jedno z toho sám o sobě není, takže bez tohoto
        // řádku vrátí resolver 42501 „Access denied" a routa ho zabalí do 502
        // „source_read_failure". Zvenčí to vypadá jako výpadek ZDROJE, přestože
        // replika odpovídá — naměřeno 2026-09-08: /source/*/kpi i /stats/* 502,
        // přitom přímé spojení do repliky četlo všechny tabulky. Plánovač týž
        // nárok nastavuje od začátku (scheduler.ts), proto tikal, zatímco živé
        // čtení nefungovalo NIKDY. Tady je to doplněno, aby se obě cesty chovaly
        // stejně; jinak zůstává jedna z nich trvale slepá.
        await aishaPg.query(`SET request.jwt.claims = '{"role":"service_role"}'`);
        const { rows } = await aishaPg.query<SourceBinding>(
          `SELECT instance_id, endpoint_url, auth_method, auth_secret_ref,
                  data_sensitivity, is_approved
             FROM public.audience_resolve_source_binding($1::uuid, $2::text)`,
          [storyId, SOURCE_ENDPOINT_ROLE],
        );
        if (rows.length === 0) return { status: 'no_binding' };
        const b = rows[0];
        if (!b.is_approved) return { status: 'unapproved' };
        return { status: 'ok', binding: b };
      } catch (err) {
        // The resolver RAISEs no_data_found (SQLSTATE P0002) when the story is
        // materialised on no active instance — a clean "unavailable", not a fault.
        if (err && typeof err === 'object' && (err as { code?: string }).code === 'P0002') {
          return { status: 'unmaterialized' };
        }
        throw err; // genuine infra failure → the route maps it to a 502 fail-loud
      } finally {
        await aishaPg.end().catch(() => undefined);
      }
    },

    async upsertEngagement(userId: string, snapshot: unknown, sourceSlug: string): Promise<void> {
      // Same mirror-write the batch /sync path uses, so a live read completes the
      // SAME user_engagement_metrics rows the audience_admin_*_v dashboards read.
      const aishaPg = new PgClient({ connectionString: config.postgresUrl });
      try {
        await aishaPg.connect();
        await aishaPg.query(
          `SELECT public.audience_upsert_user_engagement($1::uuid, $2::jsonb, $3::text)`,
          [userId, JSON.stringify(snapshot), sourceSlug],
        );
      } finally {
        await aishaPg.end().catch(() => undefined);
      }
    },

    async auditRead(storyId: string, kind: string, subjectId: string | null): Promise<void> {
      const aishaPg = new PgClient({ connectionString: config.postgresUrl });
      try {
        await aishaPg.connect();
        await aishaPg.query(
          `INSERT INTO public.audit_journal
             (action_type, action, entity_type, entity_id, area, severity, summary, details)
           VALUES ('read', 'SOURCE_LIVE_READ', 'story_instance', $1, 'source_read', 'info',
                   $2, $3::jsonb)`,
          [storyId, `live source read: ${kind}`, JSON.stringify({ story_id: storyId, subject: subjectId })],
        );
      } finally {
        await aishaPg.end().catch(() => undefined);
      }
    },
  };
}

interface ServeSpec {
  storyId: string;
  cacheKey: string;
  kind: string;
  subjectId: string | null;
  entityType: EntityType;
  externalId: string;
  /** When set, the fresh engagement result is written through for this user. */
  writeThroughUserId: string | null;
}

export function registerSourceReadRoutes(
  app: FastifyInstance,
  registry: SourceRegistry,
  config: SourceBrokerConfig,
  deps: SourceReadDeps = createPgSourceReadDeps(config),
): void {
  const guard = createAuthGuard(config);
  // Per-instance freshness cache. In-process TTL by default; a deployment that
  // wants cross-replica + event-invalidation lifts this onto @aisha/cache-redis
  // (the dormant svc-mcp-knowledge cacheLayer read-through + kb:invalidate
  // pattern) behind the same interface — /webhook/source then publishes an
  // invalidation instead of waiting for TTL. See the runtime design.
  const cache = new TtlCache<unknown>(READ_TTL_MS);

  async function serve(spec: ServeSpec, reply: FastifyReply) {
    const { storyId, cacheKey, kind, subjectId, entityType, externalId, writeThroughUserId } = spec;
    if (!UUID_RE.test(storyId)) {
      return reply.code(400).send({ error: 'invalid_story_id', message: 'storyId must be a UUID' });
    }
    try {
      // ② resolve + map each spine state to a clean code (never a raw pg 500).
      const res = await deps.resolveBinding(storyId);
      if (res.status === 'unapproved') {
        return reply.code(403).send({ error: 'source_not_approved', message: 'source is not classified/approved for reading' });
      }
      if (res.status === 'unmaterialized') {
        return reply.code(404).send({ error: 'source_not_materialized', message: 'no active instance materialises this source story' });
      }
      if (res.status === 'no_binding') {
        return reply.code(404).send({ error: 'source_binding_missing', message: 'source has no source_pg_readonly endpoint binding' });
      }
      const binding = res.binding;

      // ④ cache-first.
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return reply.send({ status: 'ok', story: storyId, live: false, cached: true, data: cached });
      }

      // ③ dispatch BY STORY + hand the adapter the resolved connection.
      const adapter = registry.getForStory(storyId);
      const connection: SourceConnection = {
        endpointUrl: binding.endpoint_url,
        authMethod: binding.auth_method,
        authSecretRef: binding.auth_secret_ref,
        dataSensitivity: binding.data_sensitivity,
      };
      const result = await adapter.getEntity(entityType, externalId, OPERATOR_SCOPE, connection);

      // ⑥ audit the read that just happened — best-effort, and BEFORE the
      // (throwing) write-through, so a failed mirror write can never suppress the
      // audit of a cross-user read that already occurred.
      void deps.auditRead(storyId, kind, subjectId).catch(() => undefined);

      // ⑤ write-through (engagement reads only): complete the SAME mirror row via
      // the snake_case boundary mapper (raw camelCase would miss every RPC key and
      // zero the row). May throw → 502; nothing is cached until it succeeds, so a
      // retry re-reads and re-attempts rather than serving a half-completed result.
      if (writeThroughUserId) {
        const snap = (result as ScopedEntityResult<ActorAggregateSnapshot>).entity;
        if (snap) await deps.upsertEngagement(writeThroughUserId, snapshotToUpsertJson(snap), adapter.config.slug);
      }

      cache.set(cacheKey, result);
      return reply.send({ status: 'ok', story: storyId, live: true, cached: false, data: result });
    } catch (err) {
      if (err instanceof SourceNotConfiguredError) {
        return reply.code(501).send({ error: 'source_not_configured', message: err.message });
      }
      // Configured-but-broken (or a resolver infra failure) → fail LOUD, no zeros.
      return reply.code(502).send({ error: 'source_read_failure', message: errMessage(err) });
    }
  }

  /**
   * Batch document listing (listEntities). Same governance as serve() — resolve →
   * approve → dispatch BY STORY → cache → one live read → audit — but NO
   * write-through: documents (ERP delivery notes, invoices) are not engagement
   * mirror rows. A story whose adapter has no listEntities (the NullDataSource, or
   * an engagement-only source) → 501 not_configured.
   */
  async function serveList(
    storyId: string,
    opts: { since?: Date; limit?: number; offset?: number },
    cacheKey: string,
    reply: FastifyReply,
  ) {
    if (!UUID_RE.test(storyId)) {
      return reply.code(400).send({ error: 'invalid_story_id', message: 'storyId must be a UUID' });
    }
    try {
      const res = await deps.resolveBinding(storyId);
      if (res.status === 'unapproved') return reply.code(403).send({ error: 'source_not_approved', message: 'source is not classified/approved for reading' });
      if (res.status === 'unmaterialized') return reply.code(404).send({ error: 'source_not_materialized', message: 'no active instance materialises this source story' });
      if (res.status === 'no_binding') return reply.code(404).send({ error: 'source_binding_missing', message: 'source has no source_pg_readonly endpoint binding' });
      const binding = res.binding;

      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return reply.send({ status: 'ok', story: storyId, live: false, cached: true, data: cached });
      }

      const adapter = registry.getForStory(storyId);
      if (typeof adapter.listEntities !== 'function') {
        return reply.code(501).send({ error: 'source_not_configured', message: 'source does not support document listing' });
      }
      const connection: SourceConnection = {
        endpointUrl: binding.endpoint_url,
        authMethod: binding.auth_method,
        authSecretRef: binding.auth_secret_ref,
        dataSensitivity: binding.data_sensitivity,
      };
      const list = await adapter.listEntities('document', connection, opts);
      void deps.auditRead(storyId, 'documents', null).catch(() => undefined);
      cache.set(cacheKey, list);
      return reply.send({ status: 'ok', story: storyId, live: true, cached: false, data: list });
    } catch (err) {
      if (err instanceof SourceNotConfiguredError) {
        return reply.code(501).send({ error: 'source_not_configured', message: err.message });
      }
      return reply.code(502).send({ error: 'source_read_failure', message: errMessage(err) });
    }
  }

  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const STAT_KINDS: ReadonlyArray<StatKind> = ['topic', 'event'];

  /**
   * Period statistics (topics / events created in ONE month), computed live by
   * the adapter — the same rows an operator used to get from an on-demand
   * export. Feature-detected (listStats is optional); cached per story+kind+month
   * like the other reads. `month` is validated HERE so a bad request is a 400,
   * never a 502 dressed up as an outage.
   */
  async function serveStats(
    storyId: string,
    kind: string,
    month: string | undefined,
    limit: number | undefined,
    reply: FastifyReply,
  ) {
    if (!UUID_RE.test(storyId)) {
      return reply.code(400).send({ error: 'invalid_story_id', message: 'storyId must be a UUID' });
    }
    if (!STAT_KINDS.includes(kind as StatKind)) {
      return reply.code(400).send({ error: 'invalid_stat_kind', message: `kind must be one of ${STAT_KINDS.join('|')}` });
    }
    if (!month || !MONTH_RE.test(month)) {
      return reply.code(400).send({ error: 'invalid_month', message: 'month must be YYYY-MM' });
    }
    const cacheKey = `${storyId}:stats:${kind}:${month}:${limit ?? ''}`;
    try {
      const res = await deps.resolveBinding(storyId);
      if (res.status === 'unapproved') return reply.code(403).send({ error: 'source_not_approved', message: 'source is not classified/approved for reading' });
      if (res.status === 'unmaterialized') return reply.code(404).send({ error: 'source_not_materialized', message: 'no active instance materialises this source story' });
      if (res.status === 'no_binding') return reply.code(404).send({ error: 'source_binding_missing', message: 'source has no source_pg_readonly endpoint binding' });
      const binding = res.binding;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return reply.send({ status: 'ok', story: storyId, live: false, cached: true, kind, month, data: cached });
      }
      const adapter = registry.getForStory(storyId);
      if (typeof adapter.listStats !== 'function') {
        return reply.code(501).send({ error: 'source_not_configured', message: 'source does not support period statistics' });
      }
      const connection: SourceConnection = {
        endpointUrl: binding.endpoint_url,
        authMethod: binding.auth_method,
        authSecretRef: binding.auth_secret_ref,
        dataSensitivity: binding.data_sensitivity,
      };
      const rows = await adapter.listStats(kind as StatKind, connection, { month, limit });
      void deps.auditRead(storyId, `stats:${kind}`, null).catch(() => undefined);
      cache.set(cacheKey, rows);
      return reply.send({ status: 'ok', story: storyId, live: true, cached: false, kind, month, data: rows });
    } catch (err) {
      if (err instanceof SourceNotConfiguredError) {
        return reply.code(501).send({ error: 'source_not_configured', message: err.message });
      }
      return reply.code(502).send({ error: 'source_read_failure', message: errMessage(err) });
    }
  }

  // ── Routes (story-scoped, source-agnostic) ────────────────────────────────
  app.get<{ Params: { storyId: string } }>(
    '/source/:storyId/kpi',
    { preHandler: guard.requireAdminOrService },
    async (req, reply) =>
      serve({
        storyId: req.params.storyId,
        cacheKey: `${req.params.storyId}:kpi`,
        kind: 'kpi',
        subjectId: null,
        entityType: 'engagement_metric',
        externalId: '__community__',
        writeThroughUserId: null, // community aggregate — no single mirror row
      }, reply),
  );

  app.get<{ Params: { storyId: string; userId: string } }>(
    '/source/:storyId/engagement/:userId',
    { preHandler: guard.requireAdminOrService },
    async (req, reply) => {
      const { storyId, userId } = req.params;
      if (!UUID_RE.test(userId)) {
        return reply.code(400).send({ error: 'invalid_user_id', message: 'userId must be a UUID' });
      }
      return serve({
        storyId,
        cacheKey: `${storyId}:eng:${userId}`,
        kind: 'engagement',
        subjectId: userId,
        entityType: 'engagement_metric',
        externalId: userId,
        writeThroughUserId: userId, // per-user read → complete the mirror row
      }, reply);
    },
  );

  app.get<{ Params: { storyId: string; memberId: string } }>(
    '/source/:storyId/member/:memberId',
    { preHandler: guard.requireAdminOrService },
    async (req, reply) => {
      const { storyId, memberId } = req.params;
      return serve({
        storyId,
        cacheKey: `${storyId}:member:${memberId}`,
        kind: 'member_detail',
        subjectId: memberId,
        entityType: 'actor',
        externalId: memberId,
        writeThroughUserId: null, // detail view — not an aggregate mirror row
      }, reply);
    },
  );

  // Operational documents (ERP delivery notes, invoices) — the 'document' entity.
  // One by external id (GUID or human doc number), or a batch list. No
  // write-through: documents are not engagement mirror rows.
  app.get<{ Params: { storyId: string; externalId: string } }>(
    '/source/:storyId/document/:externalId',
    { preHandler: guard.requireAdminOrService },
    async (req, reply) =>
      serve({
        storyId: req.params.storyId,
        cacheKey: `${req.params.storyId}:doc:${req.params.externalId}`,
        kind: 'document',
        subjectId: req.params.externalId,
        entityType: 'document',
        externalId: req.params.externalId,
        writeThroughUserId: null,
      }, reply),
  );

  app.get<{
    Params: { storyId: string };
    Querystring: { since?: string; limit?: string; offset?: string };
  }>(
    '/source/:storyId/documents',
    { preHandler: guard.requireAdminOrService },
    async (req, reply) => {
      const { since, limit, offset } = req.query;
      const opts = {
        since: since ? new Date(since) : undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      };
      const cacheKey = `${req.params.storyId}:docs:${since ?? ''}:${limit ?? ''}:${offset ?? ''}`;
      return serveList(req.params.storyId, opts, cacheKey, reply);
    },
  );
  app.get<{ Params: { storyId: string; kind: string }; Querystring: { month?: string; limit?: string } }>(
    '/source/:storyId/stats/:kind',
    { preHandler: guard.requireAdminOrService },
    async (req, reply) =>
      serveStats(
        req.params.storyId,
        req.params.kind,
        req.query.month,
        req.query.limit ? Number(req.query.limit) : undefined,
        reply,
      ),
  );

}
