import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { applySecurity, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { healthRoute } from './routes/health.js';
import { syncRoute } from './routes/sync.js';
import { homeAssistantApiRoute } from './routes/homeassistant-api.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-homeassistant' });
const app = Fastify({
  logger: safeLoggerOptions({
    level: config.logLevel,
    ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
  }),
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-homeassistant',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 50, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'svc-homeassistant' });

// Service health check
app.get('/health', async () => ({ status: 'ok', service: 'svc-homeassistant' }));

// ── Home Assistant routes ──
await app.register(healthRoute);
await app.register(syncRoute);
await app.register(homeAssistantApiRoute);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`svc-homeassistant listening on :${config.port}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
