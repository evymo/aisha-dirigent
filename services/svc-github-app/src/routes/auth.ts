import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyServiceRole } from '../auth.js';
import { getInstallationToken } from '../lib/github-jwt.js';

// ── Request schema ──────────────────────────────────────────────────

const AuthTokenRequestSchema = z.object({
  /** GitHub App installation id to exchange for an installation access token. */
  installation_id: z.number().int().positive(),
});

/**
 * POST /auth/token — Exchange installation_id for a GitHub installation access token.
 * Service-role only.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/token', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized — service_role required' });
    }

    const parseResult = AuthTokenRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Missing or invalid installation_id' });
    }
    const { installation_id } = parseResult.data;

    try {
      const token = await getInstallationToken(installation_id);
      return reply.send({ token, installation_id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err, installation_id }, 'Token acquisition failed');
      return reply.code(502).send({ error: `Token acquisition failed: ${msg}` });
    }
  });
}
