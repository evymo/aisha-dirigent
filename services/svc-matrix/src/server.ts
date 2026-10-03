import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import { applySecurity, pluginRejection } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { AuthError } from './auth.js';
import { tokenExchangeRoutes } from './routes/token-exchange.js';
import { webhookRoutes } from './routes/webhook.js';
import { clientOpsRoutes } from './routes/client-ops.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-matrix' });
const app = Fastify({
  logger: { level: config.logLevel },
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-matrix',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 60, timeWindow: 60_000 },
  skipErrorHandler: true,
});

await registerMetricsPlugin(app, { serviceName: 'svc-matrix' });

app.setErrorHandler((error: FastifyError | AuthError, _req: FastifyRequest, reply: FastifyReply) => {
  if (error instanceof AuthError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }
  // 4xx z pluginu (limit 429, validace 400) je odpověď volajícímu, ne porucha.
  const odmitnuti = pluginRejection(error);
  if (odmitnuti) return reply.status(odmitnuti.statusCode).send(odmitnuti.body);
  app.log.error(error);
  return reply.status(500).send({ error: 'Internal server error' });
});

app.get('/health', async () => ({ status: 'ok', service: 'svc-matrix' }));

await app.register(tokenExchangeRoutes);
await app.register(webhookRoutes);
await app.register(clientOpsRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`svc-matrix listening on :${config.port}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
