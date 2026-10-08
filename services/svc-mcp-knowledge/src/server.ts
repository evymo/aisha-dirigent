import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { applySecurity, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { embeddingsRoutes } from './routes/embeddings.js';
import { knowledgeEmbeddingsRoutes } from './routes/knowledge-embeddings.js';
import { ragnarokRoutes } from './routes/ragnarok.js';
import { maestroRoutes } from './routes/maestro.js';
import { mcpRoutes } from './routes/mcp.js';
import { translateRoutes } from './routes/translate.js';
import { ragEvalRoutes } from './routes/rag-eval.js';
import { graphExtractRoutes } from './routes/graph-extract.js';
import { credentials, POVERENI_Z_PROSTREDI } from './lib/credentials.js';

// MUST be first executable line — OTel auto-instrumentations attach to
// http/fetch/pg before Fastify or any provider client builds connection pools.
// Exporter → Langfuse OTLP (Phase 12 WP 0.1, sole traces backend per §-1.12 R1).
// Rollback: OTEL_SDK_DISABLED=true env in Coolify + container restart.
bootstrapOtel({ serviceName: 'svc-mcp-knowledge' });

const app = Fastify({
  logger: safeLoggerOptions({ level: config.logLevel }),
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-mcp-knowledge',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 100, timeWindow: 60_000 },
});
await registerMetricsPlugin(app, { serviceName: 'svc-mcp-knowledge' });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

/** Health check */
app.get('/health', async () => ({ status: 'ok', service: 'svc-mcp-knowledge' }));

/** Routes */
await app.register(embeddingsRoutes);
await app.register(knowledgeEmbeddingsRoutes);
await app.register(ragnarokRoutes);
await app.register(maestroRoutes);
await app.register(mcpRoutes);
await app.register(translateRoutes);
await app.register(ragEvalRoutes);
await app.register(graphExtractRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}

// Pověření z prostředí → trezor instance (jen kde trezor nic nemá; hodnotu z administrace
// nepřepíše). Selhání jednotlivých jmen hlásí čtečka nahlas sama; obsluhu neblokuje.
void credentials()
  .migrateEnvCredentials(POVERENI_Z_PROSTREDI)
  .catch((e: unknown) => app.log.error({ err: e instanceof Error ? e.message : String(e) }, 'přesun pověření z prostředí selhal'));
