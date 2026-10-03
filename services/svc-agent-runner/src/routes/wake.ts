import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { wakeClaudePoller } from '../poller.js';

/**
 * POST /wake — event-worker forwards an 'agent_run_queued' NOTIFY here so the runner
 * claims the just-queued run immediately, instead of waiting for the safety-net poll
 * (event-primary; the periodic tick remains the fallback if a NOTIFY is ever missed).
 *
 * Auth = a shared token carried in the WEBHOOK_AGENT_RUNNER URL query (?token=…). The
 * endpoint is internal-mesh only and can do nothing but nudge a claim of already-queued
 * rows (no work injection, guarded by inFlight/caps + FOR UPDATE SKIP LOCKED), so the
 * token is defence-in-depth, not the primary boundary. Fire-and-forget → 202.
 */
export async function wakeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Querystring: { token?: string } }>(
    '/wake',
    async (req: FastifyRequest<{ Querystring: { token?: string } }>, reply: FastifyReply) => {
      // Fail CLOSED: an UNSET wakeToken must NOT open the endpoint. Even though
      // this is internal-mesh only and can merely nudge a claim of already-queued
      // rows (defence-in-depth, not the primary boundary), a missing token is a
      // misconfiguration, not an authorization — reject rather than fail open.
      if (!config.wakeToken || req.query.token !== config.wakeToken) {
        return reply.code(401).send({ error: 'invalid wake token' });
      }
      void wakeClaudePoller(); // guarded internally by inFlight/caps; never throws to the caller
      return reply.code(202).send({ ok: true });
    },
  );
}
