import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { dirigentProxy } from './dirigent.js';

// @fastify/http-proxy uses undici (not global fetch), so we exercise it against a
// real localhost stub standing in for svc-ai-chat rather than mocking fetch.
describe('dirigentProxy', () => {
  let upstream: FastifyInstance;
  let gateway: FastifyInstance;
  let originalAiChatUrl: string;
  const received: { path?: string; auth?: string; body?: unknown } = {};

  beforeEach(async () => {
    upstream = Fastify();
    upstream.post('/dirigent/dispatch', async (req, reply) => {
      received.path = req.url;
      received.auth = req.headers.authorization;
      received.body = req.body;
      return reply.code(200).send({ decision: 'allow', reason: 'stub' });
    });
    await upstream.listen({ port: 0, host: '127.0.0.1' });
    const addr = upstream.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    // config is `as const` (compile-time only); point aiChatUrl at the stub for
    // the duration of the test and restore it afterwards.
    originalAiChatUrl = config.aiChatUrl;
    (config as { aiChatUrl: string }).aiChatUrl = `http://127.0.0.1:${port}`;

    gateway = Fastify();
    await gateway.register(dirigentProxy, { prefix: '/dirigent' });
    await gateway.ready();
  });

  afterEach(async () => {
    (config as { aiChatUrl: string }).aiChatUrl = originalAiChatUrl;
    await gateway?.close();
    await upstream?.close();
  });

  it('proxies /dirigent/dispatch to svc-ai-chat with Bearer passthrough and body intact', async () => {
    const res = await gateway.inject({
      method: 'POST',
      url: '/dirigent/dispatch',
      headers: {
        authorization: 'Bearer mcp_pat_token',
        'content-type': 'application/json',
      },
      payload: { event: 'stop', story_id: 'story-1' },
    });

    // Upstream response flows back through the gateway unchanged.
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ decision: 'allow', reason: 'stub' });

    // rewritePrefix preserves the path (no KC gate strips/rewrites it).
    expect(received.path).toBe('/dirigent/dispatch');
    // Bearer passthrough — the supervisor authenticates the PAT itself.
    expect(received.auth).toBe('Bearer mcp_pat_token');
    // POST body reaches the upstream.
    expect(received.body).toMatchObject({ event: 'stop', story_id: 'story-1' });
  });
});
