/**
 * Scheduler control routes — /sync/scheduler/{status,trigger}
 *
 * SECURITY: both routes are guarded by the SAME guard.requireAdminOrService as
 * /sync/run and /sync/probe (routes/sync.ts). `trigger` calls scheduler
 * .triggerNow() → runOnce(), the identical privileged source→aisha sync as
 * /sync/run; `status` discloses the source/scheduler cursor state. Registering
 * them WITHOUT a preHandler (as they were inlined in server.ts) let any caller
 * reaching the broker port drive an unauthenticated full sync and read internal
 * state — bypassing the guard entirely, not even honoring devAllowUnauthedSync.
 *
 * The guard accepts (a) a Keycloak admin/staff JWT, or (b) the gateway/cron
 * shared service token — never a spoofable identity header. Dev/CI bypass stays
 * explicit via config.devAllowUnauthedSync (default false).
 */

import type { FastifyInstance } from 'fastify';
import { createAuthGuard } from '../auth-guard.js';
import { errMessage } from '../errors.js';
import type { SourceBrokerConfig } from '../config.js';
import type { SchedulerHandle } from '../scheduler.js';

export function registerSchedulerRoutes(
  app: FastifyInstance,
  scheduler: SchedulerHandle,
  config: SourceBrokerConfig
): void {
  const guard = createAuthGuard(config);

  app.get('/sync/scheduler/status', { preHandler: guard.requireAdminOrService }, async () => ({
    intervalMs: config.syncIntervalMs,
    enabled: config.syncIntervalMs > 0,
    lastResult: scheduler.lastResult(),
    state: scheduler.syncState(),
  }));

  app.post('/sync/scheduler/trigger', { preHandler: guard.requireAdminOrService }, async (req, reply) => {
    try {
      const stats = await scheduler.triggerNow();
      return reply.send({ status: 'ok', stats });
    } catch (err) {
      return reply.code(500).send({ error: errMessage(err) });
    }
  });
}
