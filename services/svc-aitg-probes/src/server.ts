/**
 * svc-aitg-probes — OWASP AI Testing Guide runtime probe service.
 *
 * Hosts one Fastify route per AITG runtime test (APP-01, APP-03, DAT-02,
 * APP-12, …). Each route:
 *   1. Verifies a service-role bearer token (RPCs are admin/service-only).
 *   2. Validates input via Zod.
 *   3. Dispatches an LLM call through svc-ai-chat (NOT a third-party SDK
 *      directly — keeps router / Langfuse instrumentation faithful).
 *   4. Runs a heuristic classifier from @aisha/aitg/classifiers.
 *   5. Persists the outcome via aitg_record_run_audited (idempotent through
 *      RPC, no direct table writes per CLAUDE.md).
 *
 * OWASP hardening is applied uniformly via @aisha/security's applySecurity.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { applySecurity, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { promptInjectionRoute } from './routes/prompt-injection.js';
import { dataLeakRoute } from './routes/data-leak.js';
import { toxicOutputRoute } from './routes/toxic-output.js';
import { indirectInjectionRoute } from './routes/indirect-injection.js';
import { unsafeOutputRoute } from './routes/unsafe-output.js';
import { embeddingManipulationRoute } from './routes/embedding-manipulation.js';
import { modelExtractionRoute } from './routes/model-extraction.js';
import { contentBiasRoute } from './routes/content-bias.js';
import { hallucinationsRoute } from './routes/hallucinations.js';

// OTel auto-instrumentation must attach before any other module performs
// network I/O. Rollback: OTEL_SDK_DISABLED=true env + container restart.
bootstrapOtel({ serviceName: 'svc-aitg-probes' });

// trustProxy: false — službu volají jen naše kontejnery PŘÍMO, žádná proxy před ní
// není (změřeno 2026-09-26: v logu jen healthcheck, Prometheus a svc-mcp-knowledge). S `true` si
// volající volil počítadlo limitu hlavičkou X-Forwarded-For (ověřeno živě na svc-money).
const app = Fastify({ logger: safeLoggerOptions({ level: config.logLevel }), trustProxy: false });

await applySecurity(app, {
  service: 'svc-aitg-probes',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 30, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'svc-aitg-probes' });

app.get('/health', async () => ({
  status: 'ok',
  service: 'svc-aitg-probes',
  buildSha: config.buildSha,
  probes: [
    'AITG-APP-01', 'AITG-APP-02', 'AITG-APP-03', 'AITG-APP-05',
    'AITG-APP-08', 'AITG-APP-09', 'AITG-APP-10', 'AITG-APP-11',
    'AITG-APP-12', 'AITG-DAT-02',
  ],
}));

await app.register(promptInjectionRoute);
await app.register(dataLeakRoute);
await app.register(toxicOutputRoute);
await app.register(indirectInjectionRoute);
await app.register(unsafeOutputRoute);
await app.register(embeddingManipulationRoute);
await app.register(modelExtractionRoute);
await app.register(contentBiasRoute);
await app.register(hallucinationsRoute);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`svc-aitg-probes listening on :${config.port}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
