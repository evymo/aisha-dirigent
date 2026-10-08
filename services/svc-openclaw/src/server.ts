/**
 * svc-openclaw — AISHA advisory companion daemon.
 *
 * Three responsibilities, all *advisory* (no side-effects executed here):
 *
 *   POST /api/plan      — produce an execution plan for a task (via
 *                         AISHA llm-gateway, returns structured JSON).
 *   POST /api/sandbox   — dry-run validate a workflow JSON for shape +
 *                         policy compliance. Reports warnings + simulated
 *                         effects without executing anything.
 *   POST /api/notify    — enqueue a multi-channel notification. Returns
 *                         queued status. Actual dispatch via n8n
 *                         WF_OPENCLAW_NOTIFY pulling from the outbox.
 *   GET  /health        — liveness probe (no auth).
 *
 * Architectural boundary (per AISHA capability-applied principle): AISHA
 * owns side-effects via n8n + reflection orchestrator. This daemon
 * produces recommendations + structured intents; AISHA decides whether
 * to act on them. No outbound channel dispatches happen inside this
 * process.
 *
 * Security baseline (per @aisha/security):
 *   - applySecurity wires helmet + cors + rate-limit + safe error handler.
 *   - SSRF guard (createSsrfGuard) protects every outbound fetch from
 *     planner.ts + notify.ts against attacker-controlled URLs.
 *
 * Auth: Bearer token via OPENCLAW_API_KEY (constant-time compare).
 */
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { applySecurity, createSsrfGuard, routeRateLimit, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { config, validateConfigOrExit } from './config.js';
import { planExecution } from './planner.js';
import { sandboxWorkflow } from './sandbox.js';
import { enqueueNotification } from './notify.js';

/**
 * verifyToken — bearer auth gate applied to every route except /health.
 * Reads request.headers.authorization, constant-time compares against the
 * service-side OPENCLAW_API_KEY. The matching `verifyToken` + literal
 * `request.headers.authorization` references are required by the
 * service-security.gate.test.ts auth-pattern regex.
 */
function verifyToken(request: FastifyRequest, reply: FastifyReply): boolean {
  const auth = request.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'missing_authorization' });
    return false;
  }
  const token = auth.slice('Bearer '.length).trim();
  if (token.length !== config.apiKey.length) {
    reply.code(401).send({ error: 'invalid_token' });
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ config.apiKey.charCodeAt(i);
  }
  if (mismatch !== 0) {
    reply.code(401).send({ error: 'invalid_token' });
    return false;
  }
  return true;
}

// ─── /api/plan ────────────────────────────────────────────────────────
const PlanSchema = z.object({
  request_id: z.string().uuid().nullable().optional(),
  task: z
    .object({
      description: z.string().min(1, 'task.description is required'),
      type: z.string().min(1).default('general'),
    })
    .strict(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

// ─── /api/sandbox ─────────────────────────────────────────────────────
const SandboxSchema = z.object({
  request_id: z.string().uuid().nullable().optional(),
  workflow: z.union([z.record(z.string(), z.unknown()), z.string()]),
  inputs: z.record(z.string(), z.unknown()).optional(),
  timeout_s: z.number().int().min(5).max(600).optional(),
});

// ─── /api/notify ──────────────────────────────────────────────────────
const NotifySchema = z.object({
  request_id: z.string().uuid().nullable().optional(),
  channel: z.enum(['telegram', 'slack', 'matrix', 'discord', 'email', 'in_app']),
  // Bounded to blunt notification-injection through a leaked service bearer: this route is
  // internet-exposed and authenticated only by one shared key, and its payload lands in the
  // outbox that n8n later dispatches to real Slack/Telegram/email. Channel is already an enum;
  // cap the free-form fields so a compromised key can't aim an unbounded recipient or flood the
  // outbox with arbitrarily large payloads. (Per-user OIDC is the deeper fix, tracked separately.)
  recipient: z.string().max(512).optional(),
  payload: z
    .record(z.string(), z.unknown())
    .refine((p) => JSON.stringify(p).length <= 16_384, { message: 'payload exceeds 16KB' }),
  template: z.string().max(256).optional(),
  agent_slug: z.string().max(128).optional(),
  related_run_id: z.string().uuid().optional(),
  story_id: z.string().uuid().optional(),
});

export async function buildOpenClawApp() {
  const app = Fastify({
    logger: safeLoggerOptions({ level: config.logLevel }),
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024, // 5 MB — workflow JSON can be sizeable
  });

  await applySecurity(app, {
    service: config.service,
    cors: { allowlist: config.corsAllowlist },
    rateLimit: { enabled: true, max: config.rateLimitMax, timeWindow: 60_000 },
  });

  await registerMetricsPlugin(app, { serviceName: config.service });

  // OWASP A10 — single SSRF guard shared across planner + notify.
  // Pinned host allowlist + http:// + RFC1918 enabled (we call in-cluster
  // services like postgrest:3000). External hosts still require https://.
  const ssrf = createSsrfGuard({
    service: config.service,
    hostAllowlist: config.outboundHostAllowlist,
    allowedSchemes: ['http:', 'https:'],
    allowInternalNetworks: config.allowInternalNetworks,
  });

  // ─── Health (no auth, always 200 when listener is up) ──────────────────
  app.get('/health', async () => {
    return { status: 'ok', service: config.service, uptime_s: Math.floor(process.uptime()) };
  });

  // ─── /api/plan ────────────────────────────────────────────────────────
  // 'expensive' tier (10/min): every call proxies an LLM completion through llm-gateway, so
  // it is a cost amplifier — the global 120/min fallback is far too loose for it.
  app.post('/api/plan', { config: routeRateLimit('expensive') }, async (req, reply) => {
    if (!verifyToken(req, reply)) return;
    const parsed = PlanSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    try {
      const result = await planExecution(parsed.data, app.log, ssrf);
      reply.code(200).send(result);
    } catch (err) {
      app.log.error({ err }, 'plan_failed');
      reply.code(502).send({ error: 'planner_failed', detail: String(err).slice(0, 200) });
    }
  });

  // ─── /api/sandbox ─────────────────────────────────────────────────────
  app.post('/api/sandbox', async (req, reply) => {
    if (!verifyToken(req, reply)) return;
    const parsed = SandboxSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    try {
      const result = await sandboxWorkflow(parsed.data, app.log);
      reply.code(200).send(result);
    } catch (err) {
      app.log.error({ err }, 'sandbox_failed');
      reply.code(502).send({ error: 'sandbox_failed', detail: String(err).slice(0, 200) });
    }
  });

  // ─── /api/notify ──────────────────────────────────────────────────────
  // 'mutation' tier: this enqueues a real outbound notification (a side effect that reaches
  // external channels), so bound its rate to blunt outbox flooding from a compromised key.
  app.post('/api/notify', { config: routeRateLimit('mutation') }, async (req, reply) => {
    if (!verifyToken(req, reply)) return;
    const parsed = NotifySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    try {
      const result = await enqueueNotification(parsed.data, app.log, ssrf);
      reply.code(202).send(result);
    } catch (err) {
      app.log.error({ err }, 'notify_failed');
      reply.code(502).send({ error: 'notify_failed', detail: String(err).slice(0, 200) });
    }
  });

  return app;
}

export async function startOpenClawServer() {
  validateConfigOrExit();

  // Phase 12 WP 0.1 / 0.4 — bootstrap OTel BEFORE Fastify creation so the
  // auto-instrumentation captures the first HTTP frame too. Disabled at
  // runtime via OTEL_SDK_DISABLED=true env (gate-verified). serviceName
  // is a string literal (NOT config.service) to satisfy
  // wp-0-1-otel-bootstrap.gate.test.ts which greps for the exact literal.
  bootstrapOtel({ serviceName: 'svc-openclaw' });

  const app = await buildOpenClawApp();

  // ─── Graceful shutdown ────────────────────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    app.log.info({ signal }, 'shutdown_requested');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown_failed');
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port }, 'svc-openclaw listening');
  return app;
}

const isEntrypoint = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isEntrypoint) {
  await startOpenClawServer();
}
