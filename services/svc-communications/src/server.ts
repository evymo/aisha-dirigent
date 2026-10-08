import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { applySecurity, pluginRejection, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { AuthError } from './auth.js';
import { smsOtpRoutes } from './routes/sms-otp.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-communications' });
const app = Fastify({
  logger: safeLoggerOptions({ level: config.logLevel }),
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-communications',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 30, timeWindow: 60_000 },
  skipErrorHandler: true,
});

await registerMetricsPlugin(app, { serviceName: 'svc-communications' });

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

app.get('/health', async () => ({ status: 'ok', service: 'svc-communications' }));

await app.register(smsOtpRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`svc-communications listening on :${config.port}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
