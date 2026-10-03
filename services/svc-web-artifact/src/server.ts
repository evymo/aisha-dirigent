/**
 * svc-web-artifact — Fastify server. Port 3030.
 *
 * Routes:
 *   GET  /health         — liveness probe (public)
 *   POST /parse          — ingest worker (n8n calls this with service-role token)
 *   POST /seed-default   — bootstrap idempotent seed (cold-start + self-trigger with token)
 *
 * OWASP hardening: `applySecurity(app, ...)` from @aisha/security wires
 * helmet + CORS allowlist + global rate-limit + safe error handler in a single
 * call. Per-route auth uses `verifyServiceRole(req.headers.authorization)`
 * from ./auth.ts. See docs/security/OWASP_ORCHESTRATOR.md for the runbook.
 */
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { applySecurity } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { parseRoutes } from './routes/parse.js';
import { seedDefaultRoutes } from './routes/seed-default.js';


// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'svc-web-artifact' });
const app = Fastify({ logger: { level: config.logLevel }, trustProxy: true });

await applySecurity(app, {
  service: 'svc-web-artifact',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { max: 60, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'svc-web-artifact' });
await app.register(multipart, {
  limits: { fileSize: config.maxUploadBytes },
});

app.get('/health', async () => ({ status: 'ok', service: 'svc-web-artifact' }));

await app.register(parseRoutes);
await app.register(seedDefaultRoutes);

await app.listen({ host: '0.0.0.0', port: config.port });
app.log.info(`svc-web-artifact listening on :${config.port}`);

// Self-trigger default seed in the background once the server is up.
// Idempotent (route returns 304 if web_pages slug already seeded) — safe to retry.
// Disabled when AISHA_SEED_ON_BOOT=0 (e.g. local dev with manual control).
// Carries the service-role token in Authorization so it passes verifyServiceRole().
if (process.env.AISHA_SEED_ON_BOOT !== '0') {
  setTimeout(() => {
    void fetch(`http://127.0.0.1:${config.port}/seed-default`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.postgrestServiceToken}`,
      },
      body: '{}',
    })
      .then(async (res) => {
        if (res.status === 304) {
          app.log.info('seed-default: already seeded (304)');
        } else if (res.ok) {
          app.log.info({ status: res.status }, 'seed-default: completed');
        } else {
          app.log.warn({ status: res.status, body: await res.text() }, 'seed-default: non-ok');
        }
      })
      .catch((err) => app.log.warn({ err: err?.message }, 'seed-default: trigger failed (will retry on next boot)'));
  }, 3_000);
}
