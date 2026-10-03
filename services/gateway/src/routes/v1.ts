import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { config } from '../config.js';

/**
 * /v1/* → svc-ai-chat Omni facade — the "AISHA as a model" public model API.
 *
 * Public face: ask.<public_tld> (ANTHROPIC_BASE_URL=https://ask.<tld>/v1), fronted
 * by the edge → this core gateway (@aisha/gateway) → svc-ai-chat:3011. svc-ai-chat
 * is a PURE INTERNAL service (no public Traefik router / LE cert); the public /v1
 * edge lives HERE per docs/planning/AISHA_OMNI_GATEWAY.md §3.
 *
 * STREAMING (§12): the Omni facade emits SSE (reply.hijack + text/event-stream) for
 * /v1/chat/completions and /v1/messages, so this MUST stream. @fastify/http-proxy
 * (via @fastify/reply-from) pipes the upstream body UNBUFFERED — this is the whole
 * reason /v1 does NOT reuse functions.ts, whose arrayBuffer() fully buffers the
 * response and would break token streaming for IDE agents (Claude Code / Cursor).
 *
 * AUTH: Bearer-passthrough. The facade authenticates the PAT itself
 * (Authorization: Bearer mcp_<token> → validate_mcp_token, routes/omniAuth.ts).
 * The gateway MUST NOT apply KC auth here — NO preHandler. The global CORS hook
 * (server.ts) lets no-Origin IDE/agent traffic straight through, and the global
 * rate-limit still applies (heavy PAT usage may want a per-route override later).
 *
 * NOTE: tier-3+ orchestrated runs do NOT stream over the connection (§6.5 — they
 * return 202 + a poll URL), so this lane only carries fast, continuously-tokenised
 * responses; undici's default idle timeouts are adequate. Confirm SSE latency/jitter
 * under concurrent IDE load before Phase A (design §3 pre-Phase-A load test).
 */
export const omniV1Proxy: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Mounted with prefix '/v1' in server.ts; rewritePrefix '/v1' preserves the path
  // so /v1/messages → <aiChatUrl>/v1/messages (svc-ai-chat registers /v1 at root).
  await app.register(httpProxy, {
    upstream: config.aiChatUrl,
    rewritePrefix: '/v1',
    http2: false,
    proxyPayloads: true,
  });
};
