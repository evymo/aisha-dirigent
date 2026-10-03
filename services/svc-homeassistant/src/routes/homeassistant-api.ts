import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { handleHaHealth } from './health.js';
import { handleHaSync, type SyncRequestBody } from './sync.js';

/**
 * Request body for the action-dispatching endpoint. The `action`
 * discriminator selects which underlying handler runs. `sync_production_data`
 * carries the same field set as the /ha/sync body (see SyncRequestBody).
 */
type HomeAssistantApiBody = SyncRequestBody & { action?: unknown };

/**
 * POST /homeassistant-api — single gateway-facing entry point that mirrors
 * the web client contract (src/hooks/homeassistant/haApi.ts), which posts a
 * `body.action` discriminator rather than hitting /ha/health or /ha/sync
 * directly.
 *
 * Delegation:
 *   action='health'               → handleHaHealth  (connectivity check)
 *   action='sync_production_data' → handleHaSync    (production data sync)
 *
 * The delegated handlers own all auth and response shaping, so this route
 * adds no auth of its own beyond routing — the exact same 401/403/400/502
 * behaviour and success payloads are preserved. An unknown or missing
 * action is rejected with 400 before any privileged work happens.
 */
export async function homeAssistantApiRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: HomeAssistantApiBody }>(
    '/homeassistant-api',
    async (req: FastifyRequest<{ Body: HomeAssistantApiBody }>, reply: FastifyReply): Promise<FastifyReply> => {
      const action = req.body?.action;

      switch (action) {
        case 'health':
          return handleHaHealth(req, reply);
        case 'sync_production_data':
          return handleHaSync(req as FastifyRequest<{ Body: SyncRequestBody }>, reply);
        default:
          return reply.status(400).send({
            error: "Invalid or missing 'action'. Expected 'health' or 'sync_production_data'.",
          });
      }
    },
  );
}
