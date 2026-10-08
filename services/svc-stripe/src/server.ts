import type { FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import rawBody from 'fastify-raw-body';
import { applySecurity, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { webhookRoute } from './routes/webhook.js';
import { checkoutRoute } from './routes/checkout.js';
import { subscriptionCheckoutRoute } from './routes/subscription-checkout.js';
import { customerPortalRoute } from './routes/customer-portal.js';
import { checkSubscriptionRoute } from './routes/check-subscription.js';
import { refundRoute } from './routes/refund.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-stripe' });
const app = Fastify({
  logger: safeLoggerOptions({
    level: config.logLevel,
    ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
  }),
  trustProxy: true,
});

// Raw body needed for Stripe webhook signature verification.
// Must register BEFORE applySecurity so the helmet/cors hooks see the raw body
// hook in the pre-parsing pipeline.
await app.register(rawBody, {
  field: 'rawBody',
  global: false,
  encoding: 'utf8',
  runFirst: true,
});

await applySecurity(app, {
  service: 'svc-stripe',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 60, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'svc-stripe' });

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'svc-stripe' }));

// ── Stripe routes ──
// Webhook needs raw body — register with content type parser
app.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (_req: FastifyRequest, body: string, done: (err: Error | null, body?: unknown) => void) => {
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

// Enable raw body only for webhook route
app.addHook('preHandler', async (req: FastifyRequest) => {
  if (req.url === '/webhook') {
    await (req as unknown as { generateRawBody: () => Promise<void> }).generateRawBody?.();
  }
});

await app.register(webhookRoute);
await app.register(checkoutRoute);
await app.register(subscriptionCheckoutRoute);
await app.register(customerPortalRoute);
await app.register(checkSubscriptionRoute);
await app.register(refundRoute);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`svc-stripe listening on :${config.port}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
