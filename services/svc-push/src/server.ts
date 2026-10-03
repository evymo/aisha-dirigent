import type { FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { applySecurity } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { stavWebPush } from './lib/web-push.js';
import { sendPushRoute } from './routes/send-push.js';
import { sendPushNotificationRoute } from './routes/send-push-notification.js';
import { aishaPushRoute } from './routes/aisha-push.js';
import { campaignsRoute } from './routes/campaigns.js';
import { questionnaireRemindersRoute } from './routes/questionnaire-reminders.js';
import { reminderNotificationsRoute } from './routes/reminder-notifications.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-push' });
const app = Fastify({
  logger: {
    level: config.logLevel,
    ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
  },
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-push',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 100, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'svc-push' });

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'svc-push' }));

// ── Push notification routes ──
await app.register(sendPushRoute);
await app.register(sendPushNotificationRoute);
await app.register(aishaPushRoute);
await app.register(campaignsRoute);
await app.register(questionnaireRemindersRoute);
await app.register(reminderNotificationsRoute);

// Web push: verdikt o VAPID klíčích při STARTU, ne až první nedoručenou zprávou.
// Půlka páru projde každou kontrolou „proměnná je nastavená" a projeví se až
// odmítnutím u poskytovatele — tohle je jediné místo, kde se to dozví operátor.
const vapid = stavWebPush();
if (!vapid.ok) {
  app.log.error({ duvod: vapid.duvod }, 'web push VYPNUT — VAPID klíče nejsou platný pár');
}

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`svc-push listening on :${config.port}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
