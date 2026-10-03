import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, isAdminOrStaff, AuthError } from '../auth.js';
import { getHomeAssistantConfig } from '../lib/ha-config.js';
import { fetchHaConfig, readNonEmptyString, isRecord } from '../lib/ha-client.js';

/**
 * Core Home Assistant connectivity-check handler.
 *
 * Extracted from the /ha/health route so the same logic can be invoked
 * directly by the action-dispatching /homeassistant-api route without
 * duplicating auth, config-loading, or response shaping. Preserves the
 * exact auth checks and response shapes of the original handler.
 */
export async function handleHaHealth(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  let user;
  try {
    user = await verifyToken(req.headers.authorization);
  } catch (err) {
    const status = err instanceof AuthError ? err.statusCode : 401;
    return reply.status(status).send({ error: err instanceof Error ? err.message : 'Unauthorized' });
  }

  if (!isAdminOrStaff(user)) {
    return reply.status(403).send({ error: 'Forbidden' });
  }

  const haConfig = await getHomeAssistantConfig();
  if (!haConfig) {
    return reply.status(400).send({
      error: 'Home Assistant is not configured. Set homeassistant_base_url and homeassistant_access_token.',
    });
  }

  try {
    const health = await fetchHaConfig(haConfig);
    return reply.send({
      config: {
        location_name: readNonEmptyString(health.config.location_name),
        time_zone: readNonEmptyString(health.config.time_zone),
        unit_system: isRecord(health.config.unit_system) ? health.config.unit_system : null,
      },
      ha_version: health.haVersion,
      success: true,
      transport: health.transport,
    });
  } catch {
    return reply.status(502).send({ error: 'Failed to connect to Home Assistant' });
  }
}

/**
 * GET /ha/health — Check Home Assistant connectivity.
 */
export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.post('/ha/health', handleHaHealth);
}
