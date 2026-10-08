/**
 * OpenClaw advisory bridge routes — service-role-only.
 *
 *   POST /openclaw/plan
 *     Body: { task: jsonb, constraints?: jsonb, related_run_id?: uuid }
 *     1. Calls aisha_request_plan_from_openclaw (audit + request_id)
 *     2. POSTs to OpenClaw HTTP API
 *     3. Returns execution_plan jsonb
 *
 *   POST /openclaw/sandbox
 *     Body: { workflow_json: jsonb, inputs?: jsonb, timeout_s?: int, related_run_id?: uuid }
 *     1. Calls aisha_dryrun_in_openclaw_sandbox (audit + request_id)
 *     2. POSTs to OpenClaw sandbox API
 *     3. Returns { success, warnings[], simulated_effects }
 *
 *   POST /openclaw/notify
 *     Body: { channel, recipient, payload: jsonb, template?, ... }
 *     1. Calls aisha_notify_via_openclaw RPC (enqueues in outbox)
 *     2. Returns { notification_id, status: 'queued' }
 *     n8n WF_OPENCLAW_NOTIFY dispatches asynchronously every 30s.
 *
 * OpenClaw is treated as an external advisory service: AISHA decides WHAT to
 * do based on the response (planner / sandbox warnings), and AISHA itself
 * executes via existing capabilities (n8n workflows, reflection orchestrator).
 * OpenClaw never executes side-effects directly.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyServiceRole, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';
import { credentials } from '../lib/credentials.js';

const PlanSchema = z.object({
  task: z.record(z.string(), z.unknown()),
  constraints: z.record(z.string(), z.unknown()).optional(),
  related_run_id: z.string().uuid().optional(),
});

const SandboxSchema = z.object({
  workflow_json: z.record(z.string(), z.unknown()),
  inputs: z.record(z.string(), z.unknown()).optional(),
  timeout_s: z.number().int().min(5).max(600).optional(),
  related_run_id: z.string().uuid().optional(),
});

const NotifySchema = z.object({
  channel: z.enum(['telegram', 'slack', 'matrix', 'discord', 'email', 'in_app']),
  recipient: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  template: z.string().optional(),
  agent_slug: z.string().optional(),
  related_run_id: z.string().uuid().optional(),
  story_id: z.string().uuid().optional(),
});

// Per-clow backend resolution — AISHA's "which provider/model for this sub-agent" decision
const ResolveClowSchema = z.object({
  clow: z.object({
    purpose: z.string().min(1),
    task_kind: z.string().optional(),
    capability_tags: z.array(z.string()).optional(),
    expected_tokens: z.number().int().positive().optional(),
    deadline_hours: z.number().int().min(0).optional(),
    max_cost: z.number().min(0).optional(),
    allow_batch: z.boolean().optional(),
    allow_local: z.boolean().optional(),
    needs_tools: z.boolean().optional(),
    needs_vision: z.boolean().optional(),
    criticality: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  }),
  context: z
    .object({
      session_id: z.string().optional(),
      parent_run_id: z.string().uuid().optional(),
      budget_remaining: z.number().min(0).optional(),
    })
    .optional(),
});

const McpRegisterSchema = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  transport: z.enum(['http', 'sse', 'stdio', 'websocket']),
  endpoint_url: z.string().url().optional(),
  stdio_command: z.array(z.string()).optional(),
  auth_kind: z.enum(['bearer', 'api_key_header', 'none', 'oauth2']).optional(),
  auth_env_var: z.string().optional(),
  capability_tags: z.array(z.string()).optional(),
  exposes_llm: z.boolean().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const McpTestSchema = z.object({
  slug: z.string().min(1),
  probe_method: z.string().optional(),
});

const OPENCLAW_URL = process.env.OPENCLAW_URL ?? '';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY ?? '';
const OPENCLAW_TIMEOUT_MS = parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? '60000', 10);

function openclawConfigured(): boolean {
  return Boolean(OPENCLAW_URL && OPENCLAW_API_KEY);
}

async function callOpenclaw(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!openclawConfigured()) {
    return { ok: false, status: 503, data: { error: 'openclaw_not_configured' } };
  }
  const url = `${OPENCLAW_URL.replace(/\/$/, '')}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENCLAW_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OPENCLAW_TIMEOUT_MS),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 502, data: { error: 'openclaw_unreachable', detail: String(err).slice(0, 200) } };
  }
}

export async function openclawBridgeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>('/openclaw/plan', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const parsed = PlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.message });
    }

    const audit = await rpcService<Record<string, unknown>>('aisha_request_plan_from_openclaw', {
      p_task: parsed.data.task,
      p_constraints: parsed.data.constraints ?? {},
      p_related_run_id: parsed.data.related_run_id ?? null,
    });

    const remote = await callOpenclaw('/api/plan', {
      request_id: (audit as Record<string, unknown> | null)?.request_id ?? null,
      task: parsed.data.task,
      constraints: parsed.data.constraints ?? {},
    });

    return reply.code(remote.ok ? 200 : remote.status).send({
      request_id: (audit as Record<string, unknown> | null)?.request_id ?? null,
      plan: remote.ok ? remote.data : null,
      openclaw_status: remote.status,
      degraded: !remote.ok,
      error: remote.ok ? undefined : (remote.data as Record<string, unknown>)?.error,
    });
  });

  app.post<{ Body: unknown }>('/openclaw/sandbox', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const parsed = SandboxSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.message });
    }

    const audit = await rpcService<Record<string, unknown>>('aisha_dryrun_in_openclaw_sandbox', {
      p_workflow_json: parsed.data.workflow_json,
      p_inputs: parsed.data.inputs ?? {},
      p_timeout_s: parsed.data.timeout_s ?? 120,
      p_related_run_id: parsed.data.related_run_id ?? null,
    });

    const remote = await callOpenclaw('/api/sandbox', {
      request_id: (audit as Record<string, unknown> | null)?.request_id ?? null,
      workflow_json: parsed.data.workflow_json,
      inputs: parsed.data.inputs ?? {},
      timeout_s: parsed.data.timeout_s ?? 120,
    });

    return reply.code(remote.ok ? 200 : remote.status).send({
      request_id: (audit as Record<string, unknown> | null)?.request_id ?? null,
      result: remote.ok ? remote.data : null,
      openclaw_status: remote.status,
      degraded: !remote.ok,
      error: remote.ok ? undefined : (remote.data as Record<string, unknown>)?.error,
    });
  });

  app.post<{ Body: unknown }>('/openclaw/notify', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const parsed = NotifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.message });
    }

    const enqueued = await rpcService<Record<string, unknown>>('aisha_notify_via_openclaw', {
      p_channel: parsed.data.channel,
      p_recipient: parsed.data.recipient ?? null,
      p_payload: parsed.data.payload,
      p_template: parsed.data.template ?? 'plain',
      p_agent_slug: parsed.data.agent_slug ?? 'aisha',
      p_related_run_id: parsed.data.related_run_id ?? null,
      p_story_id: parsed.data.story_id ?? null,
    });

    return reply.code(202).send(enqueued);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /openclaw/resolve-clow — AISHA decides per-clow backend
  //
  // Body: {
  //   clow: { purpose, task_kind, capability_tags, expected_tokens,
  //           deadline_hours, max_cost, allow_batch, allow_local,
  //           needs_tools, needs_vision, criticality },
  //   context: { session_id, parent_run_id, budget_remaining }
  // }
  // Returns: { resolved, top: { provider_slug, model_id, backend_kind, strategy, ... },
  //            candidates[], reasoning }
  //
  // Caller pattern (OpenClaw orchestrator):
  //   for clow in plan.clows:
  //     resolution = POST /openclaw/resolve-clow {clow, context}
  //     dispatch_clow(clow, resolution.top)
  // ─────────────────────────────────────────────────────────────────────────
  app.post<{ Body: unknown }>('/openclaw/resolve-clow', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const parsed = ResolveClowSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.message });
    }

    const resolution = await rpcService<Record<string, unknown>>('aisha_resolve_clow_backend', {
      p_clow: parsed.data.clow,
      p_context: parsed.data.context ?? {},
    });

    return reply.send(resolution ?? { resolved: false, reasoning: 'RPC returned null' });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /mcp/register — admin/staff registers a new MCP server
  // ─────────────────────────────────────────────────────────────────────────
  app.post<{ Body: unknown }>('/mcp/register', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const parsed = McpRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.message });
    }

    const result = await rpcService<Record<string, unknown>>('aisha_register_mcp_server', {
      p_slug: parsed.data.slug,
      p_display_name: parsed.data.display_name,
      p_transport: parsed.data.transport,
      p_endpoint_url: parsed.data.endpoint_url ?? null,
      p_stdio_command: parsed.data.stdio_command ?? null,
      p_auth_kind: parsed.data.auth_kind ?? 'bearer',
      p_auth_env_var: parsed.data.auth_env_var ?? null,
      p_capability_tags: parsed.data.capability_tags ?? [],
      p_exposes_llm: parsed.data.exposes_llm ?? false,
      p_description: parsed.data.description ?? null,
      p_source: 'manual',
      p_metadata: parsed.data.metadata ?? {},
    });

    return reply.code(201).send(result);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /mcp/test — probe an MCP server + record result
  //
  // Audits the request via aisha_test_mcp_server, performs HTTP probe (for
  // http/sse transports) or rejects stdio probes (caller must run those in
  // svc-agent-runner sandbox).
  // ─────────────────────────────────────────────────────────────────────────
  app.post<{ Body: unknown }>('/mcp/test', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }

    const parsed = McpTestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.message });
    }

    const audit = await rpcService<{
      test_id: string;
      payload: {
        transport: string;
        endpoint_url: string | null;
        stdio_command: string[] | null;
        auth_kind: string;
        auth_env_var: string | null;
        probe_method: string;
      };
    }>('aisha_test_mcp_server', {
      p_probe_method: parsed.data.probe_method ?? 'tools/list',
      p_slug: parsed.data.slug,
    });

    if (!audit?.payload) {
      return reply.code(500).send({ error: 'audit_rpc_failed' });
    }

    const probeStartedAt = Date.now();
    let ok = false;
    let latencyMs = 0;
    let supportedMethods: string[] = [];
    let sampleExcerpt: string | null = null;
    let errorMsg: string | null = null;

    if (audit.payload.transport === 'http' || audit.payload.transport === 'sse') {
      try {
        // Token, který MCP server deklaruje (mcp_server_registry.auth_env_var), z trezoru instance.
        const token = audit.payload.auth_env_var ? (await credentials.get(audit.payload.auth_env_var)) ?? undefined : undefined;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        // OWASP A10 — endpoint_url is user-registered MCP endpoint; SSRF
        // guard rejects DNS-rebinding and internal-IP probes.
        const { createSsrfGuard, parseHostAllowlist } = await import('@aisha/security');
        const guard = createSsrfGuard({
          service: 'svc-ai-chat',
          hostAllowlist: parseHostAllowlist(config.ssrfHostAllowlist),
          allowedSchemes: ['https:', 'http:'],
          allowInternalNetworks: true,
        });
        const res = await guard.safeFetch(`${audit.payload.endpoint_url ?? ''}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: audit.test_id,
            method: audit.payload.probe_method,
            params: {},
          }),
          signal: AbortSignal.timeout(15_000),
        });
        latencyMs = Date.now() - probeStartedAt;
        const text = await res.text();
        sampleExcerpt = text.slice(0, 280);
        ok = res.ok;
        try {
          const parsedResp = JSON.parse(text) as { result?: { tools?: Array<{ name: string }> } };
          const tools = parsedResp.result?.tools;
          if (Array.isArray(tools)) {
            supportedMethods = tools.map((t) => t.name).slice(0, 50);
          }
        } catch {
          // sample retained as text
        }
        if (!ok) errorMsg = `HTTP ${res.status}`;
      } catch (err) {
        latencyMs = Date.now() - probeStartedAt;
        ok = false;
        errorMsg = String(err).slice(0, 200);
      }
    } else {
      // stdio probes need sandboxed exec — defer to svc-agent-runner in a future PR.
      ok = false;
      errorMsg = `transport=${audit.payload.transport} not yet supported by /mcp/test`;
    }

    const record = await rpcService<Record<string, unknown>>('aisha_record_mcp_test_result', {
      p_slug: parsed.data.slug,
      p_ok: ok,
      p_latency_ms: latencyMs,
      p_supported_methods: supportedMethods,
      p_sample_response_excerpt: sampleExcerpt,
      p_error: errorMsg,
    });

    return reply.send({
      test_id: audit.test_id,
      ok,
      latency_ms: latencyMs,
      supported_methods: supportedMethods,
      record,
      error: errorMsg,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /providers/evaluate?task_kind=<kind> — list providers ranked for task
  // ─────────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { task_kind?: string; include_local?: string; include_mcp?: string; cost_class?: string } }>(
    '/providers/evaluate',
    async (req, reply) => {
      try {
        verifyServiceRole(req.headers.authorization);
      } catch (err) {
        return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
      }

      const taskKind = req.query.task_kind ?? 'chat';
      const filters: Record<string, unknown> = {};
      if (req.query.include_local) filters.include_local = req.query.include_local !== 'false';
      if (req.query.include_mcp) filters.include_mcp = req.query.include_mcp !== 'false';
      if (req.query.cost_class) filters.only_cost_class = req.query.cost_class;

      const rows = await rpcService<Array<Record<string, unknown>>>('aisha_evaluate_provider_for_task', {
        p_task_kind: taskKind,
        p_filters: filters,
      });

      return reply.send({ task_kind: taskKind, filters, providers: rows ?? [] });
    },
  );
}
