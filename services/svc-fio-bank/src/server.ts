import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { applySecurity } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { syncRoutes } from './routes/sync.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-fio-bank' });
const app = Fastify({
  logger: {
    level: config.logLevel,
    ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
  },
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-fio-bank',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 30, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'svc-fio-bank' });

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'svc-fio-bank' }));

// ── Fio Bank routes ──
await app.register(syncRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`svc-fio-bank listening on :${config.port}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
