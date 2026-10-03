/**
 * /chat → svc-ai-chat governed chat — THE answer chain (route_decision →
 * context_compose → tool_call, tracer → ai_runs; the numbers the Správa section
 * charts). Bearer-passthrough like /dirigent: the route authenticates the KC JWT
 * itself and mints its own user-scoped PostgREST token — the gateway MUST NOT
 * re-gate here (no preHandler). Exposed so the extranet ask can ride the chain
 * that already existed instead of a parallel one.
 */
import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { config } from '../config.js';

export const chatProxy: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(httpProxy, {
    upstream: config.aiChatUrl,
    rewritePrefix: '/chat',
    http2: false,
    proxyPayloads: true,
  });
};
