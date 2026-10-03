/**
 * HTTP route contract tests for svc-openclaw.
 *
 * Uses Fastify inject against buildOpenClawApp(), so the test covers the real
 * route schemas and auth gate without binding a TCP port or calling live
 * llm-gateway/PostgREST services.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applySecurity: vi.fn(async (app: FastifyInstance) => app),
  registerMetricsPlugin: vi.fn(async () => undefined),
  bootstrapOtel: vi.fn(),
  safeFetch: vi.fn(),
  // Defaults are wired to the real implementations in vi.mock below; these
  // overrides let individual tests force the route-level 502 catch branches
  // (planner_failed / sandbox_failed) without touching the happy-path tests.
  planExecution: vi.fn(),
  sandboxWorkflow: vi.fn(),
}));

vi.mock('@aisha/security', () => ({
  applySecurity: mocks.applySecurity,
  createSsrfGuard: () => ({ safeFetch: mocks.safeFetch }),
  // Per-route rate-limit config helper — returns the Fastify `{ rateLimit }` shape. The real
  // @fastify/rate-limit plugin is not registered here (applySecurity is mocked to a no-op), so
  // the config is inert in tests; the helper just needs to exist and return the right shape.
  routeRateLimit: (tier: string) => ({ rateLimit: { max: tier === 'expensive' ? 10 : 30, timeWindow: 60_000 } }),
  // ⛔ Mock modulu MUSÍ nést i `requireEnv` — config ho volá při importu.
  // Chybějící export v mocku se projeví jako pád VŠECH testů v souboru,
  // ne jako chybějící hodnota, takže příčina není z hlášky vidět.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('@aisha/observability/metrics', () => ({
  registerMetricsPlugin: mocks.registerMetricsPlugin,
}));

vi.mock('@aisha/observability/otel', () => ({
  bootstrapOtel: mocks.bootstrapOtel,
}));

vi.mock('./planner.js', async (importActual) => {
  const actual = await importActual<typeof import('./planner.js')>();
  return { planExecution: (...args: Parameters<typeof actual.planExecution>) => mocks.planExecution(...args) };
});

vi.mock('./sandbox.js', async (importActual) => {
  const actual = await importActual<typeof import('./sandbox.js')>();
  return { sandboxWorkflow: (...args: Parameters<typeof actual.sandboxWorkflow>) => mocks.sandboxWorkflow(...args) };
});

let app: FastifyInstance | undefined;

function setOpenClawEnv(): void {
  process.env.OPENCLAW_API_KEY = 'openclaw-test-key';
  process.env.AISHA_LLM_GATEWAY_URL = 'http://llm-gateway:4000';
  process.env.AISHA_LLM_GATEWAY_KEY = 'llm-gateway-test-key';
  process.env.POSTGREST_URL = 'http://postgrest:3000';
  process.env.POSTGREST_SERVICE_JWT = 'postgrest-test-jwt';
  process.env.OPENCLAW_OUTBOUND_HOSTS = 'llm-gateway,postgrest';
  process.env.LOG_LEVEL = 'silent';
}

async function buildTestApp(): Promise<FastifyInstance> {
  vi.resetModules();
  setOpenClawEnv();
  // Bind the real planner/sandbox implementations AFTER env is set + modules
  // reset, so their `config` snapshot reflects the test env. Tests that need
  // the 502 catch branches override these mocks before calling buildTestApp.
  if (!mocks.planExecution.getMockImplementation()) {
    const realPlanner = await vi.importActual<typeof import('./planner.js')>('./planner.js');
    mocks.planExecution.mockImplementation(realPlanner.planExecution);
  }
  if (!mocks.sandboxWorkflow.getMockImplementation()) {
    const realSandbox = await vi.importActual<typeof import('./sandbox.js')>('./sandbox.js');
    mocks.sandboxWorkflow.mockImplementation(realSandbox.sandboxWorkflow);
  }
  const { buildOpenClawApp } = await import('./server.js');
  const instance = await buildOpenClawApp();
  await instance.ready();
  app = instance;
  return instance;
}

function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer openclaw-test-key' };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  mocks.applySecurity.mockClear();
  mocks.registerMetricsPlugin.mockClear();
  mocks.bootstrapOtel.mockClear();
  mocks.safeFetch.mockReset();
  // Fully reset so each test re-binds the real planner/sandbox in
  // buildTestApp (or overrides with mockRejectedValueOnce to hit a 502).
  mocks.planExecution.mockReset();
  mocks.sandboxWorkflow.mockReset();
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
  delete process.env.OPENCLAW_API_KEY;
  delete process.env.AISHA_LLM_GATEWAY_URL;
  delete process.env.AISHA_LLM_GATEWAY_KEY;
  delete process.env.POSTGREST_URL;
  delete process.env.POSTGREST_SERVICE_JWT;
  delete process.env.OPENCLAW_OUTBOUND_HOSTS;
  delete process.env.LOG_LEVEL;
});

describe('svc-openclaw HTTP routes', () => {
  it('keeps /health unauthenticated', async () => {
    const instance = await buildTestApp();

    const res = await instance.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'svc-openclaw' });
  });

  it('requires bearer auth on advisory routes', async () => {
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/plan',
      payload: { task: { description: 'Summarize stack health', type: 'analysis' } },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'missing_authorization' });
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it('routes /api/plan through llm-gateway and normalizes the returned plan', async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                steps: [
                  {
                    step: 99,
                    action: 'inspect-runtime',
                    inputs: { scope: 'full-light' },
                    rationale: 'Confirm local runtime wiring.',
                  },
                ],
                estimated_total_ms: 2500,
              }),
            },
          },
        ],
      }),
    );
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/plan',
      headers: authHeaders(),
      payload: {
        request_id: '00000000-0000-4000-8000-000000000001',
        task: { description: 'Inspect local stack', type: 'analysis' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      request_id: '00000000-0000-4000-8000-000000000001',
      source: 'llm_gateway',
      plan: {
        estimated_total_ms: 2500,
        steps: [
          {
            step: 1,
            action: 'inspect-runtime',
            inputs: { scope: 'full-light' },
            rationale: 'Confirm local runtime wiring.',
          },
        ],
      },
    });
    const [url, init] = mocks.safeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://llm-gateway:4000/v1/chat/completions');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer llm-gateway-test-key' });
  });

  it('validates /api/notify before enqueueing to PostgREST', async () => {
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/notify',
      headers: authHeaders(),
      payload: { channel: 'sms', payload: { text: 'unsupported channel' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized notify payload before it reaches the outbox (injection blast-radius cap)', async () => {
    const instance = await buildTestApp();

    // >16KB payload: a leaked bearer must not be able to stuff arbitrarily large content into
    // the outbox that n8n dispatches to real channels. The bound is enforced at the schema.
    const res = await instance.inject({
      method: 'POST',
      url: '/api/notify',
      headers: authHeaders(),
      payload: { channel: 'email', recipient: 'a@b.test', payload: { blob: 'x'.repeat(20_000) } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    // never enqueued — the guard is BEFORE the outbox RPC.
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it('routes /api/notify to the OpenClaw outbox RPC and returns queued status', async () => {
    mocks.safeFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          notification_id: '11111111-1111-4111-8111-111111111111',
          status: 'queued',
        },
      ]),
    );
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/notify',
      headers: authHeaders(),
      payload: {
        request_id: '00000000-0000-4000-8000-000000000002',
        channel: 'matrix',
        recipient: '@operator:aisha.local',
        payload: { text: 'Stack check finished' },
        template: 'stack_check',
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      request_id: '00000000-0000-4000-8000-000000000002',
      notification_id: '11111111-1111-4111-8111-111111111111',
      status: 'queued',
      channel: 'matrix',
    });
    const [url, init] = mocks.safeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://postgrest:3000/rpc/aisha_notify_via_openclaw');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer postgrest-test-jwt' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      p_channel: 'matrix',
      p_recipient: '@operator:aisha.local',
      p_payload: { text: 'Stack check finished' },
      p_template: 'stack_check',
    });
  });

  it('requires bearer auth on /api/sandbox', async () => {
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/sandbox',
      payload: { workflow: { nodes: [] } },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'missing_authorization' });
    expect(mocks.sandboxWorkflow).not.toHaveBeenCalled();
  });

  it('rejects /api/sandbox with a missing workflow field (400)', async () => {
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/sandbox',
      headers: authHeaders(),
      payload: { inputs: { a: 1 } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    expect(mocks.sandboxWorkflow).not.toHaveBeenCalled();
  });

  it('dry-runs a valid workflow through /api/sandbox', async () => {
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/sandbox',
      headers: authHeaders(),
      payload: { workflow: { nodes: [{ name: 'fetch', type: 'http', url: 'http://localhost:8080' }] } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, step_count: 1 });
  });

  it('returns 502 sandbox_failed when sandboxWorkflow throws', async () => {
    mocks.sandboxWorkflow.mockRejectedValueOnce(new Error('sandbox boom'));
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/sandbox',
      headers: authHeaders(),
      payload: { workflow: { nodes: [] } },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'sandbox_failed' });
    expect(res.json().detail).toContain('sandbox boom');
  });

  it('returns 502 planner_failed when planExecution throws', async () => {
    mocks.planExecution.mockRejectedValueOnce(new Error('planner boom'));
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/plan',
      headers: authHeaders(),
      payload: { task: { description: 'Inspect', type: 'analysis' } },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'planner_failed' });
    expect(res.json().detail).toContain('planner boom');
  });

  it('returns the manual_review fallback (source:fallback) when the planner degrades', async () => {
    // Real planExecution: llm-gateway returns a non-ok status → graceful
    // manual_review fallback, still HTTP 200 (advisory, never a 5xx).
    mocks.safeFetch.mockResolvedValueOnce(new Response('upstream down', { status: 503 }));
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/plan',
      headers: authHeaders(),
      payload: { task: { description: 'Inspect', type: 'analysis' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('fallback');
    expect(body.plan.steps[0].action).toBe('manual_review');
    expect(body.warnings).toEqual(['llm_gateway_http_503']);
  });

  it('returns 502 notify_failed when the outbox RPC fails', async () => {
    // Real enqueueNotification: PostgREST returns 403 → throws rpc_failed →
    // route maps to 502 notify_failed.
    mocks.safeFetch.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    const instance = await buildTestApp();

    const res = await instance.inject({
      method: 'POST',
      url: '/api/notify',
      headers: authHeaders(),
      payload: { channel: 'matrix', payload: { text: 'hi' } },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'notify_failed' });
    expect(res.json().detail).toContain('rpc_failed');
  });
});
