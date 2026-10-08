import Fastify, { type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify';
import { applySecurity, pluginRejection, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { AuthError } from './auth.js';
import { pluginHostRoutes } from './routes/execute.js';
import { registryRoutes } from './routes/registry.js';
import { sandboxBrokerRoutes } from './routes/broker.js';
import { assertBrokerSecretConfigured } from './broker-secret.js';
import { spustitPlanovac } from './planovac/smycka.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-plugin-system' });
assertBrokerSecretConfigured();
const app = Fastify({
  logger: safeLoggerOptions({ level: config.logLevel }),
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-plugin-system',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 30, timeWindow: 60_000 },
  skipErrorHandler: true,
});

await registerMetricsPlugin(app, { serviceName: 'svc-plugin-system' });

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

app.get('/health', async () => ({ status: 'ok', service: 'svc-plugin-system' }));

await app.register(pluginHostRoutes);
await app.register(registryRoutes);
await app.register(sandboxBrokerRoutes);

// ⛔ NAMĚŘENO 2026-09-18 (guru): hook se registroval až PO `listen()` →
// FastifyError „already listening. Cannot call addHook" → exit(1) při KAŽDÉM
// startu → 11 restartů → Coolify zastavil celý aisha-core (API 6 h dole).
// Hook se proto registruje před `listen()`; plánovač se spouští až po něm.
let zastavPlanovac: (() => void) | null = null;
app.addHook('onClose', async () => zastavPlanovac?.());

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`svc-plugin-system listening on :${config.port}`);
  // Plánovač pluginů: cron capability podle plugin_schedules. Bez izolovaného
  // runneru se plugin spustit nedá, takže bez něj nemá co plánovat.
  if (config.agentRunnerEnabled) {
    zastavPlanovac = spustitPlanovac(app.log);
    app.log.info('plugin scheduler started');
  } else {
    app.log.warn('plugin scheduler NOT started: AGENT_RUNNER_ENABLED is false');
  }
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
