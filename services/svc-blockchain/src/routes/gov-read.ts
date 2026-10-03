import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

/** Allowed Cosmos REST path prefixes. */
const ALLOWED_PREFIXES = [
  '/cosmos/gov/v1/proposals',
  '/cosmos/bank/v1beta1/supply',
  '/cosmos/base/tendermint/v1beta1/node_info',
  '/cosmos/staking/v1beta1/validators',
];

/**
 * GET /gov/* — Public read-only proxy to Cosmos governance REST API.
 * No authentication required.
 */
export async function govReadRoutes(app: FastifyInstance): Promise<void> {
  app.get('/gov/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const cosmosPath = (req.params as Record<string, string>)['*'] ?? '';
    const fullPath = `/${cosmosPath}`;

    const isAllowed = ALLOWED_PREFIXES.some((prefix) => fullPath.startsWith(prefix));
    if (!isAllowed) {
      return reply.code(403).send({ error: 'Path not allowed' });
    }

    try {
      const url = new URL(req.url, `http://localhost:${config.port}`);
      const cosmosUrl = `${config.cosmosRestUrl}${fullPath}${url.search}`;

      const res = await fetch(cosmosUrl, { signal: AbortSignal.timeout(10_000) });
      const body = await res.text();

      reply
        .code(res.status)
        .header('Content-Type', res.headers.get('Content-Type') ?? 'application/json')
        .header('Cache-Control', 'public, max-age=5')
        .send(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cosmos node unreachable';
      return reply.code(502).send({ error: message });
    }
  });
}
