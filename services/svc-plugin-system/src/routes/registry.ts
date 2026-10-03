import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth.js';
import { rpcService } from '../postgrest.js';

/**
 * Plugin registry — list available AISHA plugins.
 */
export async function registryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/registry', async (req: FastifyRequest, _reply: FastifyReply) => {
    await verifyToken(req.headers.authorization);

    const plugins = await rpcService<Array<Record<string, unknown>>>('get_available_plugins', {});

    return {
      plugins: plugins.map((p) => ({
        slug: p.slug,
        name: p.name,
        version: p.version,
        description: p.description,
        capabilities: p.capabilities,
        status: p.status,
      })),
      total: plugins.length,
    };
  });
}
