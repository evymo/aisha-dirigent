import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { config } from '../config.js';

/**
 * /dirigent/* → svc-ai-chat Dirigent supervisor — the CONTROL / supervisory
 * channel (path ③ of the comms architecture: not the model face, not MCP).
 *
 * The developer-side relay hook (.claude/hooks/aisha-supervisor-relay.mjs) POSTs
 * session events to `${AISHA_GATEWAY_URL}/dirigent/dispatch`. That route lives in
 * svc-ai-chat (routes/dirigent-supervisor.ts, registered at root), and svc-ai-chat
 * is a PURE INTERNAL service (no public Traefik router). Without this mount the
 * relay 404s from a real dev machine and the supervisory channel is effectively
 * dead in the cloud — this closes that exposure gap so the same public core
 * gateway that fronts /v1 (model) and /functions (MCP) also fronts /dirigent.
 *
 * AUTH: Bearer-passthrough — identical to the /v1 Omni lane. The supervisor route
 * authenticates the user JWT itself (verifyToken in dirigent-supervisor.ts) and
 * validates story ownership before its service_role RPCs. The gateway MUST NOT
 * apply KC auth here — NO preHandler. The global CORS hook lets no-Origin
 * IDE/agent traffic through, and the global rate-limit still applies.
 *
 * NOT streaming: /dirigent/dispatch returns a small JSON body ({additionalContext,
 * decision, reason} or {}), so unlike /v1 this does not need SSE. proxyPayloads
 * forwards the POST body to the upstream.
 */
export const dirigentProxy: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Mounted with prefix '/dirigent' in server.ts; rewritePrefix '/dirigent'
  // preserves the path so /dirigent/dispatch → <aiChatUrl>/dirigent/dispatch
  // (svc-ai-chat registers dirigentSupervisorRoutes at root).
  await app.register(httpProxy, {
    upstream: config.aiChatUrl,
    rewritePrefix: '/dirigent',
    http2: false,
    proxyPayloads: true,
  });
};
