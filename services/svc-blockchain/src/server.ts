import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { applySecurity, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { dispatchRoutes } from './routes/dispatch.js';
import { recordAuditRoutes } from './routes/record-audit.js';
import { ledgerSyncRoutes } from './routes/ledger-sync.js';
import { govReadRoutes } from './routes/gov-read.js';
import { claimRewardRoutes } from './routes/claim-reward.js';
import { governanceVoteRoutes } from './routes/governance-vote.js';
import { chainHeadAnchorRoutes } from './routes/chain-head-anchor.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-blockchain' });
const app = Fastify({
  logger: safeLoggerOptions({ level: config.logLevel }),
  trustProxy: true,
});

await applySecurity(app, {
  service: 'svc-blockchain',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 60, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'svc-blockchain' });

/** Health check */
app.get('/health', async () => ({ status: 'ok', service: 'svc-blockchain' }));

/** Routes */
await app.register(dispatchRoutes);
await app.register(recordAuditRoutes);
await app.register(ledgerSyncRoutes);
await app.register(govReadRoutes);
await app.register(claimRewardRoutes);
await app.register(governanceVoteRoutes);
await app.register(chainHeadAnchorRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
