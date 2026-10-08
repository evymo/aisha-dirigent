/**
 * svc-source-broker — Fastify entrypoint
 *
 * Mirrors svc-github-app + svc-stripe structure exactly:
 *   - Load config from env vars
 *   - Initialize JWT manager (source-api service-level auth)
 *   - Register proxy, webhook, sync routes
 *   - Start Fastify
 */

import Fastify from 'fastify';
import { applySecurity, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import rawBody from 'fastify-raw-body';
import pino from 'pino';

import { loadConfig } from './config.js';
import { SourceAuthManager } from './auth.js';
import { SourcePgClient } from './clients/pg-readonly-driver.js';
import { registerWebhookRoutes } from './routes/webhook.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerSourceReadRoutes } from './routes/source-read.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSchedulerRoutes } from './routes/scheduler.js';
import { SourceRegistry } from './adapters/source-registry.js';
import { loadSourceAdapterPlugins } from './adapters/plugin-host.js';
import { createScheduler } from './scheduler.js';
import { createLiDriver } from './clients/li-driver.js';
import { createMoneyLane } from './clients/money-lane.js';
import { registerMoneyRoutes } from './routes/money.js';

// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any other
// module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-source-broker' });

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino(safeLoggerOptions({ level: process.env.LOG_LEVEL ?? 'info' }));

  // Auth manager — owns service-level JWT acquisition + HMAC webhook verify.
  // (Webhook route uses verifyWebhookSignature + verifyAuthHandshake; auth route uses
  // it for the 3-step OTP login proxy.)
  const auth = new SourceAuthManager(config);

  // PG client — used by /sync/run for aggregation pulls
  // (reads source-postgres via the source_crm_readonly contract)
  const pgClient = new SourcePgClient(config);

  // Note: source-api uses interactive OTP login (startOnboarding → verifyOnboarding
  // → sourceJwt with authHandshake-only). It's not designed for machine users; we skip
  // service-level JWT acquisition at startup. All read flows use the PG readonly
  // client (data substrate); user-initiated login goes through /auth/source/login
  // which proxies the 3-step flow + (optionally) does Keycloak Token Exchange.

  // Validate source-postgres connectivity at startup (best-effort)
  try {
    const probe = await pgClient.probe();
    if (!probe.ok) {
      logger.warn({ probe }, 'svc-source-broker: source-postgres probe failed; sync routes will retry on demand');
    } else {
      logger.info({ latencyMs: probe.latencyMs }, 'svc-source-broker: source-postgres reachable');
      // ACL drift canary at startup — verify the source contract once so schema
      // drift is visible in logs immediately, not discovered mid-sync. Non-fatal:
      // the scheduler re-checks before every tick and refuses to sync on drift.
      try {
        const drift = await pgClient.verifyContract(new Date().toISOString());
        if (drift.hardDrift) {
          logger.error({ drift: drift.issues }, 'svc-source-broker: HARD contract drift at startup — sync will refuse to run until resolved');
        } else if (drift.softDrift) {
          logger.warn({ drift: drift.issues }, 'svc-source-broker: soft contract drift at startup (type changes; proceeding)');
        } else {
          logger.info({ source: drift.source }, 'svc-source-broker: source contract verified, no drift');
        }
      } catch (err) {
        logger.warn({ err }, 'svc-source-broker: contract canary error at startup; continuing');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'svc-source-broker: pg client probe error; continuing');
  }

  // Fastify 5 accepts logger as boolean or options object (not pino instance).
  const app = Fastify({
    logger: safeLoggerOptions({ level: config.logLevel }),
    bodyLimit: 1_048_576, // 1MB
    trustProxy: true,
  });

  // Raw body needed for webhook HMAC verification — the source signs the exact
  // bytes, so re-serializing JSON would break verification. Register BEFORE
  // applySecurity so the raw-body hook sits early in the pre-parsing pipeline.
  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  });

  // Shared security primitives (helmet + CORS allowlist + rate limit). The
  // OWASP cross-service adoption gate requires every service to use
  // applySecurity from @aisha/security rather than ad-hoc plugin wiring.
  await applySecurity(app, {
    service: 'svc-source-broker',
    cors: { allowlist: config.corsAllowlist },
    rateLimit: { enabled: config.rateLimitEnabled, max: 100, timeWindow: 60_000 },
  });

  await registerMetricsPlugin(app, { serviceName: 'svc-source-broker' });

  // Health endpoint
  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'svc-source-broker',
    source_token_cached: true,
  }));

  // Register feature routes
  registerWebhookRoutes(app, auth, config);
  registerSyncRoutes(app, pgClient, config);
  registerAuthRoutes(app, config, pgClient);

  // Generic live source-read routes: dispatch by story slug over the registry.
  // Upstream ships only the NullDataSource default (source-read is optional);
  // forks register their real adapter (a plugin) at boot via the plugin host —
  // SOURCE_ADAPTER_PLUGIN_ENTRY + SOURCE_ADAPTER_STORY_ID (fail-soft: a broken
  // or absent plugin keeps the NullDataSource fallback, 501 not_configured).
  const sourceRegistry = new SourceRegistry();
  await sourceRegistry.load();
  await loadSourceAdapterPlugins(sourceRegistry, config, logger);
  registerSourceReadRoutes(app, sourceRegistry, config);

  // Scheduler — periodic multi-source drain on SOURCE_SYNC_INTERVAL_MS interval.
  // Disabled when SOURCE_SYNC_INTERVAL_MS=0. Each tick enumerates the approved
  // sources via audience_list_approved_sources and syncs each per-source (its own
  // endpoint, cursor + circuit breaker) — it builds its own per-source clients,
  // so it does not take the single default pgClient.
  const scheduler = createScheduler(config, app.log, sourceRegistry);
  await scheduler.start();

  // li-driver — pull-from-drop ingest of local-ingest export bundles
  // (sourceSlug 'local-ingest'). Independent failure domain + cadence from the
  // engagement drain: one bad drop never touches the source sync and vice-versa.
  // OFF unless LOCAL_INGEST_DROP_DIR is set (tier:optional / provision_when_env)
  // — the local-ingest capability is optional exactly like a missing plugin.
  const liDriver = createLiDriver(config, app.log);
  liDriver.start();

  // money-lane — PUSH doklady z účetnictví do ingestu (opak li-driveru, který
  // hotové balíčky jen VYZVEDÁVÁ). Do 2026-08-31 tenhle směr neexistoval:
  // `IngestClient` i `feedDocumentsToIngest` byly napsané a otestované, ale
  // nikdo je nesestrojil, takže vstupní cesta ingestu neměla ŽÁDNÉHO
  // zapisovatele. Vypnuto, dokud nejsou obě adresy — schopnost je volitelná.
  const moneyLane = createMoneyLane(config, app.log);
  moneyLane.start();

  // Scheduler status + manual trigger — guarded by the SAME admin/service guard
  // as /sync/run (registerSchedulerRoutes). `trigger` runs the identical
  // privileged source→aisha sync, so it must never be unauthenticated.
  registerSchedulerRoutes(app, scheduler, config);

  // Ruční tah + TEST SPOJENÍ pro administraci. Týž strážce jako /sync/run:
  // spouští privilegovaný tah do cizí sítě, takže nikdy nesmí být bez identity.
  registerMoneyRoutes(app, moneyLane, config);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('svc-source-broker shutting down');
    scheduler.stop();
    liDriver.stop();
    moneyLane.stop();
    await app.close();
    await pgClient.disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port, syncIntervalMs: config.syncIntervalMs }, 'svc-source-broker listening');
}

main().catch((err) => {
  // No console.* in service runtime (OWASP A09 gate) — write to stderr directly.
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`svc-source-broker failed to start: ${detail}\n`);
  process.exit(1);
});
