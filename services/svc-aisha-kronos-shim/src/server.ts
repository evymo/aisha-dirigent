/**
 * svc-aisha-kronos-shim
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **Soft adapter** Maestro → AISHA. Maestru poskytuje Kronos-compatible API,
 * ale uvnitř všechno proxuje na existující AISHA logiku — žádný Mongo, žádný
 * MinIO, žádný upstream Kronos.
 *
 * Endpoints (per packages/insight/maestro/maestro/services/kronos.py):
 *   GET  /projects/{project_id}/                  → mcp_get_story_context
 *   POST /sessions/                               → mcp_store_agent_memory(memory_type='maestro_session')
 *   POST /turns/                                  → mcp_store_agent_memory(memory_type='maestro_turn')
 *   POST /projects/{project_id}/nlp/rag/          → Ragnarok (sync)
 *   POST /projects/{project_id}/nlp/rag/stream    → Ragnarok (NDJSON stream)
 *   GET  /knowledge_base/?project_id=...          → AISHA virtual KB record
 *   GET  /resources/{resource_type}/              → static FSM / system prompt stubs
 *   GET  /health                                   → service health
 *
 * Auth: X-Api-Key header (Maestro convention v CONFIG.KRONOS_API_KEY).
 *
 * Default port: 9625 (Alquist Kronos default — Maestro ho má jako fallback).
 */
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { applySecurity, safeLoggerOptions } from '@aisha/security';
import { config } from './config.js';
import { projectsRoutes } from './routes/projects.js';
import { sessionsRoutes } from './routes/sessions.js';
import { nlpRoutes } from './routes/nlp.js';
import { knowledgeBaseRoutes } from './routes/knowledge-base.js';
import { resourcesRoutes } from './routes/resources.js';

const app = Fastify({
  logger: safeLoggerOptions({ level: config.logLevel }),
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-aisha-kronos-shim',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 120, timeWindow: 60_000 },
});

/** Health check (žádná auth — pro Docker healthchecks + liveness probes) */
app.get('/health', async () => ({
  status: 'ok',
  service: 'svc-aisha-kronos-shim',
  ragnarok_configured: Boolean(config.ragnarokUrl && config.ragnarokApiKey),
  postgrest_configured: Boolean(config.postgrestUrl && config.postgrestServiceToken),
}));

/** Routes */
await app.register(projectsRoutes);
await app.register(sessionsRoutes);
await app.register(nlpRoutes);
await app.register(knowledgeBaseRoutes);
await app.register(resourcesRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info({ port: config.port }, 'svc-aisha-kronos-shim listening');
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
