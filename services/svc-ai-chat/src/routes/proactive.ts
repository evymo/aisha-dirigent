/**
 * POST /proactive — on-demand entry point into the proactive trigger engine.
 *
 * Actions:
 *   - evaluate: evaluate all active ai_proactive_trigger_definitions for a source
 *     table/event against the supplied record data (condition → cooldown → agent
 *     autonomy → governed LLM dispatch → save_proactive_run). This is the SAME
 *     engine (lib/proactiveEngine.ts) the platform's trigger definitions are built
 *     for — the RPCs it uses (get_active_triggers_for_source, check_trigger_cooldown,
 *     save_proactive_run, get_agent_catalog_entry) all exist in aisha/db/sql/functions.
 *     It complements the data-driven dispatcher (fn_dispatch_proactive_triggers,
 *     PR #564) as the HTTP-invokable executor (e.g. the n8n bridge webhook target).
 *   - stats: platform-wide proactive stats (active triggers + runs today). The
 *     underlying RPCs are admin/service-scoped, so stats is SERVICE-ROLE ONLY —
 *     a per-user stats surface needs its own user-scoped RPC first (fail-loud 403,
 *     never leak platform-wide numbers to a regular user).
 *
 * History: this route previously called proactive_evaluate_triggers /
 * proactive_get_stats / proactive_get_my_stats — RPCs that were never defined in
 * this repo's schema (a leftover of the legacy edge-function port), so every call
 * 500'd with PGRST202. Rewired to the in-repo engine instead of resurrecting
 * phantom RPCs.
 *
 * Identity invariant (locked by proactive.unit.test.ts): on the USER path the
 * acting user id is ALWAYS the verified token's userId — never the request body.
 * On the SERVICE path the body's user_id is required (services act on behalf of
 * a user; the engine needs a concrete user for cooldown + run records).
 */
import type { FastifyInstance } from 'fastify';
import { verifyToken, verifyServiceRole, AuthError, type VerifiedUser } from '../auth.js';
import { createServiceRpcAdapter } from '../lib/rpcAdapter.js';
import { createTracer } from '../lib/tracer.js';
import { createProactiveEngine, type SourceEventInput } from '../lib/proactiveEngine.js';

const SOURCE_EVENTS = ['INSERT', 'UPDATE', 'DELETE', 'CRON'] as const;
type SourceEvent = (typeof SOURCE_EVENTS)[number];

interface ProactiveBody {
  action: 'evaluate' | 'stats';
  /** Table that emitted the event (matches ai_proactive_trigger_definitions.source_table). */
  source_table?: string;
  /** INSERT | UPDATE | DELETE | CRON. */
  source_event?: string;
  /** The triggering record's data — conditions are evaluated against it. */
  record_data?: Record<string, unknown>;
  /** Optional id of the source record (provenance on the saved run). */
  source_record_id?: string;
  /** SERVICE path only: the user the evaluation acts on behalf of. */
  user_id?: string;
}

export async function proactiveRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ProactiveBody }>('/proactive', async (req, reply) => {
    let user: VerifiedUser | null = null;
    let isService = false;

    const authHeader = req.headers.authorization ?? '';
    try {
      if (authHeader.startsWith('Bearer ey')) {
        user = await verifyToken(authHeader);
      } else {
        verifyServiceRole(authHeader);
        isService = true;
      }
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const { action, source_table, source_event, record_data, source_record_id, user_id } = req.body ?? {};

    if (!action || !['evaluate', 'stats'].includes(action)) {
      return reply.code(400).send({ error: 'action must be evaluate or stats' });
    }

    // The engine reads trigger definitions + agent catalog and records runs — all
    // service-plane data (the definitions are admin-managed, not per-user rows).
    const serviceClient = createServiceRpcAdapter();

    if (action === 'evaluate') {
      // Identity: user path = verified token, service path = explicit body user_id (required).
      const targetUserId = isService ? user_id : user!.userId;
      if (!targetUserId) {
        return reply.code(400).send({ error: 'user_id is required on the service-role path' });
      }
      if (!source_table || !source_event) {
        return reply.code(400).send({ error: 'source_table and source_event are required for evaluate' });
      }
      if (!SOURCE_EVENTS.includes(source_event as SourceEvent)) {
        return reply.code(400).send({ error: `source_event must be one of ${SOURCE_EVENTS.join(', ')}` });
      }
      if (record_data !== undefined && (typeof record_data !== 'object' || record_data === null || Array.isArray(record_data))) {
        return reply.code(400).send({ error: 'record_data must be an object when provided' });
      }

      const tracer = await createTracer(serviceClient, { kind: 'proactive', actorUserId: targetUserId });
      const engine = createProactiveEngine(serviceClient, tracer);
      const input: SourceEventInput = {
        sourceTable: source_table,
        sourceEvent: source_event as SourceEvent,
        // CRON/DELETE events legitimately carry no record payload; field conditions
        // simply do not match then (an honest empty result, not a fallback).
        recordData: record_data ?? {},
        userId: targetUserId,
        sourceRecordId: source_record_id,
      };
      try {
        const results = await engine.evaluateSource(input);
        await tracer.finish(results.some((r) => r.error) ? 'failed' : 'succeeded', {
          source_table,
          source_event,
          trigger_count: results.length,
        });
        return reply.send({
          action: 'evaluate',
          source_table,
          source_event,
          result: {
            triggered: results.some((r) => r.matched && !r.skippedReason && !r.error),
            trigger_count: results.length,
            details: results,
          },
        });
      } catch (err) {
        // Fail-loud: an engine failure is a 500 with a recorded trace — never a fabricated
        // { triggered: false } success.
        await tracer.finish('failed', { error: err instanceof Error ? err.message : String(err) }).catch(() => {});
        req.log?.error?.({ err, source_table, source_event }, 'proactive evaluate failed');
        return reply.code(500).send({ error: 'proactive evaluation failed' });
      }
    }

    // stats — platform-wide numbers from admin-scoped RPCs: service-role only.
    if (!isService) {
      return reply.code(403).send({
        error: 'stats is service-role only (no user-scoped proactive stats RPC exists yet)',
      });
    }
    const tracer = await createTracer(serviceClient, { kind: 'proactive' });
    const engine = createProactiveEngine(serviceClient, tracer);
    try {
      const stats = await engine.getStats();
      await tracer.finish('succeeded', { action: 'stats' });
      return reply.send({ action: 'stats', stats });
    } catch (err) {
      await tracer.finish('failed', { error: err instanceof Error ? err.message : String(err) }).catch(() => {});
      req.log?.error?.({ err }, 'proactive stats failed');
      return reply.code(500).send({ error: 'proactive stats failed' });
    }
  });
}
