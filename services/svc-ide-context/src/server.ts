/**
 * svc-ide-context — entrypoint
 *
 * Backend single source of truth for dynamic agent instruction generation
 * across IDEs (Claude Code, Cursor, GitHub Copilot, JetBrains future).
 *
 * Endpoints (Phase 13.1):
 *   - GET /health
 *   - GET /context/:workspaceId           → workspace envelope JSON
 *   - GET /instructions/:ide?workspace=…  → rendered IDE-specific instructions
 *
 * Endpoints (Phase 13.4):
 *   - WS  /subscribe/:workspaceId?        → realtime push of envelope changes
 *
 * Auth: Keycloak JWT (verified via @aisha/security JWKS cache). Allowed
 * Keycloak clients: aisha-app, aisha-dirigent-device, aisha-ide-bridge.
 * Visibility enforced at RPC level via is_admin_or_staff() +
 * is_story_participant() helpers from P7.
 */
import Fastify from "fastify";
import { applySecurity, safeLoggerOptions } from "@aisha/security";
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from "./config.js";
import { contextRoutes } from "./routes/context.js";
import { instructionsRoutes } from "./routes/instructions.js";
import { subscribeRoutes } from "./routes/subscribe.js";
import { getRealtimeSubscriber } from "./lib/subscriber.js";


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-ide-context' });
// trustProxy: false — službu volají jen naše kontejnery PŘÍMO, žádná proxy před ní
// není (změřeno 2026-09-26: v logu jen healthcheck, Prometheus a nikdo další). S `true` si
// volající volil počítadlo limitu hlavičkou X-Forwarded-For (ověřeno živě na svc-money).
const app = Fastify({
  logger: safeLoggerOptions({ level: config.logLevel }),
  trustProxy: false,
});

await applySecurity(app, {
  service: "svc-ide-context",
  cors: { allowlist: config.corsAllowlist },
  rateLimit: {
    enabled: config.rateLimitEnabled,
    max: 60,
    timeWindow: 60_000,
  },
});

await registerMetricsPlugin(app, { serviceName: 'svc-ide-context' });

/** Health check */
app.get("/health", async () => ({
  status: "ok",
  service: "svc-ide-context",
  version: "0.1.0",
}));

/** Routes */
await app.register(contextRoutes);
await app.register(instructionsRoutes);
await app.register(subscribeRoutes);

// Phase 13 WP 13.4 — start the realtime subscriber once at boot. The
// subscriber listens on `ws:db_changes` (published by event-worker) and
// fans out `context_changed` events to connected WS clients. Falls into
// passive mode when AISHA_SHARED_REDIS_DISABLED=true.
await getRealtimeSubscriber().start({
  info: (msg) => { app.log.info(msg); },
  error: (msg) => { app.log.error(msg); },
});

// Graceful shutdown — flush in-flight WS sessions cleanly.
async function shutdown(): Promise<void> {
  await getRealtimeSubscriber().stop().catch(() => undefined);
  await app.close().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT",  () => { void shutdown(); });

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
