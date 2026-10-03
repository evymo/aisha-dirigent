import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

/**
 * /realtime/v1/* → WebSocket upgrade proxy to ws-gateway.
 *
 * Handles WebSocket upgrades for real-time subscriptions.
 * Non-WS requests get proxied as HTTP for SSE fallback.
 */
export const realtimeProxy: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.all('/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const isUpgrade = (req.headers.upgrade ?? '').toLowerCase() === 'websocket';
    const path = (req.params as { '*': string })['*'] ?? '';
    const upstreamBase = config.wsGatewayUrl;
    const upstreamUrl = `${upstreamBase}/realtime/${path}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

    if (isUpgrade) {
      // WebSocket upgrade — proxy using raw socket passthrough
      // @fastify/websocket or http-proxy handles this; for now return 101 info
      // The actual WS proxy requires a WebSocket-aware middleware.
      // In production, Traefik handles WS upgrades directly to ws-gateway:3002.
      //
      // This route exists as fallback for non-Traefik setups:
      return reply.status(426).send({
        error: 'ws_upgrade_required',
        message: 'WebSocket connections should target ws-gateway directly. Configure Traefik to route /realtime/v1/* to ws-gateway:3002.',
        ws_direct_url: upstreamBase,
      });
    }

    // HTTP fallback (SSE, long-poll, health)
    try {
      const headers: Record<string, string> = {};
      if (req.headers.authorization) headers['authorization'] = req.headers.authorization;
      if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
      if (req.headers['x-request-id']) headers['x-request-id'] = req.headers['x-request-id'] as string;

      const upstreamRes = await fetch(upstreamUrl, {
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
        headers,
        method: req.method,
        signal: AbortSignal.timeout(30_000),
      });

      const responseHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((v, k) => {
        if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
          responseHeaders[k] = v;
        }
      });

      const body = await upstreamRes.arrayBuffer();
      return reply.status(upstreamRes.status).headers(responseHeaders).send(Buffer.from(body));
    } catch (err) {
      req.log.error({ err, path }, 'Realtime proxy error');
      return reply.status(502).send({ error: 'upstream_error', message: 'Failed to reach realtime service' });
    }
  });
};
