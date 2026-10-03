import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { applySecurity } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import rawBody from 'fastify-raw-body';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { repoOpsRoutes } from './routes/repo-ops.js';
import { webhookBridgeRoutes } from './routes/webhook-bridge.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-github-app' });
const app = Fastify({
  logger: { level: config.logLevel },
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-github-app',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 100, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'svc-github-app' });
await app.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8' });

/** Health check */
app.get('/health', async () => ({ status: 'ok', service: 'svc-github-app' }));

/** Routes */
await app.register(authRoutes);
await app.register(repoOpsRoutes);
await app.register(webhookBridgeRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
