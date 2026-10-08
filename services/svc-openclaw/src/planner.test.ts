/**
 * Unit tests for planner.ts — covers every manual_review fallback branch,
 * the hard 7-step cap, and the happy llm_gateway path.
 *
 * The planner's only outbound I/O is `ssrf.safeFetch`, which we stub per
 * case. `config` is read at module import time, so each test sets env +
 * `vi.resetModules()` then imports the module fresh (mirrors server.test.ts).
 */
import type { FastifyBaseLogger } from 'fastify';
import type { SsrfGuard } from '@aisha/security';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  level: 'silent',
  child: () => noopLog,
  silent: () => {},
  isLevelEnabled: () => true,
  bindings: () => ({}),
  flush: () => {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as FastifyBaseLogger;

const safeFetch = vi.fn();
const ssrf = { safeFetch } as unknown as SsrfGuard;

function setConfiguredEnv(): void {
  process.env.AISHA_LLM_GATEWAY_URL = 'http://llm-gateway:4000';
  process.env.AISHA_LLM_GATEWAY_KEY = 'llm-gateway-test-key';
  process.env.OPENCLAW_OUTBOUND_HOSTS = 'llm-gateway,postgrest';
}

function clearConfigEnv(): void {
  delete process.env.AISHA_LLM_GATEWAY_URL;
  delete process.env.AISHA_LLM_GATEWAY_KEY;
  delete process.env.OPENCLAW_OUTBOUND_HOSTS;
}

/** Imports planExecution with the current process.env baked into config. */
async function loadPlanner(): Promise<typeof import('./planner.js').planExecution> {
  vi.resetModules();
  const mod = await import('./planner.js');
  return mod.planExecution;
}

function gatewayResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TASK = { description: 'Inspect local stack', type: 'analysis' };

beforeEach(() => {
  safeFetch.mockReset();
  setConfiguredEnv();
});

afterEach(() => {
  clearConfigEnv();
});

describe('planExecution — manual_review fallbacks', () => {
  it('falls back when llm-gateway is not configured (no safeFetch call)', async () => {
    clearConfigEnv();
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf);

    expect(r.source).toBe('fallback');
    expect(r.request_id).toBeNull();
    expect(r.plan.steps).toHaveLength(1);
    expect(r.plan.steps[0].action).toBe('manual_review');
    expect(r.warnings).toEqual(['llm_gateway_not_configured']);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('falls back when llm-gateway is unreachable (safeFetch throws)', async () => {
    safeFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const planExecution = await loadPlanner();

    const r = await planExecution(
      { request_id: '00000000-0000-4000-8000-000000000001', task: TASK },
      noopLog,
      ssrf,
    );

    expect(r.source).toBe('fallback');
    expect(r.request_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(r.plan.steps[0].action).toBe('manual_review');
    expect(r.warnings).toEqual(['llm_gateway_unreachable']);
    expect(r.plan.steps[0].rationale).toContain('ECONNREFUSED');
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back when llm-gateway returns a non-ok HTTP status', async () => {
    safeFetch.mockResolvedValueOnce(new Response('upstream boom', { status: 503 }));
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf);

    expect(r.source).toBe('fallback');
    expect(r.plan.steps[0].action).toBe('manual_review');
    expect(r.plan.steps[0].rationale).toBe('llm-gateway returned HTTP 503');
    expect(r.warnings).toEqual(['llm_gateway_http_503']);
  });

  it('falls back when the LLM returns unparseable JSON', async () => {
    safeFetch.mockResolvedValueOnce(gatewayResponse('this is not json at all'));
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf);

    expect(r.source).toBe('fallback');
    expect(r.plan.steps[0].action).toBe('manual_review');
    expect(r.warnings).toEqual(['llm_response_unparseable']);
  });

  it('falls back when the LLM returns an empty/non-array step list', async () => {
    safeFetch.mockResolvedValueOnce(
      gatewayResponse(JSON.stringify({ steps: [], estimated_total_ms: 100 })),
    );
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf);

    expect(r.source).toBe('fallback');
    expect(r.plan.steps[0].action).toBe('manual_review');
    expect(r.warnings).toEqual(['llm_empty_plan']);
  });

  it('treats a non-array steps field as an empty plan and falls back', async () => {
    safeFetch.mockResolvedValueOnce(
      gatewayResponse(JSON.stringify({ steps: 'oops', estimated_total_ms: 100 })),
    );
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf);

    expect(r.source).toBe('fallback');
    expect(r.warnings).toEqual(['llm_empty_plan']);
  });
});

describe('planExecution — normalization', () => {
  it('caps the plan at 7 steps regardless of LLM output', async () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({
      step: i + 1,
      action: `step-${i + 1}`,
      rationale: `r${i + 1}`,
    }));
    safeFetch.mockResolvedValueOnce(
      gatewayResponse(JSON.stringify({ steps, estimated_total_ms: 9000 })),
    );
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf);

    expect(r.source).toBe('llm_gateway');
    expect(r.plan.steps).toHaveLength(7);
    // steps are renumbered 1..7 in order
    expect(r.plan.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.plan.steps[0].action).toBe('step-1');
    expect(r.plan.steps[6].action).toBe('step-7');
  });

  it('strips a stray markdown fence and renumbers steps', async () => {
    const fenced = '```json\n' + JSON.stringify({ steps: [{ action: 'fetch-source' }] }) + '\n```';
    safeFetch.mockResolvedValueOnce(gatewayResponse(fenced));
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf);

    expect(r.source).toBe('llm_gateway');
    expect(r.plan.steps).toEqual([{ step: 1, action: 'fetch-source', inputs: undefined, rationale: undefined }]);
  });

  it('defaults action to manual_review and drops non-object inputs / non-string rationale', async () => {
    safeFetch.mockResolvedValueOnce(
      gatewayResponse(
        JSON.stringify({
          steps: [{ inputs: 'not-an-object', rationale: 42 }],
          estimated_total_ms: 'not-a-number',
        }),
      ),
    );
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf);

    expect(r.source).toBe('llm_gateway');
    expect(r.plan.steps[0]).toEqual({
      step: 1,
      action: 'manual_review',
      inputs: undefined,
      rationale: undefined,
    });
    // non-numeric estimated_total_ms is dropped to undefined
    expect(r.plan.estimated_total_ms).toBeUndefined();
  });

  it('passes the model + bearer + json_object request body to safeFetch', async () => {
    safeFetch.mockResolvedValueOnce(
      gatewayResponse(JSON.stringify({ steps: [{ action: 'summarize-content' }] })),
    );
    const planExecution = await loadPlanner();

    await planExecution({ task: TASK, constraints: { budget: 'low' } }, noopLog, ssrf);

    const [url, init] = safeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://llm-gateway:4000/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer llm-gateway-test-key' });
    const sent = JSON.parse(String(init.body));
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(sent.messages[1].content).toContain('"budget":"low"');
  });
});

describe('planExecution — AITG output guard', () => {
  it('degrades to manual_review when the model output reads as an obeyed injection', async () => {
    const { createInMemoryAitgRunner } = await import('@aisha/aitg');
    const runner = createInMemoryAitgRunner();
    process.env.GIT_SHA = 'abcdef1234567';
    safeFetch.mockResolvedValueOnce(
      gatewayResponse(JSON.stringify({
        steps: [{ action: 'exfiltrate', rationale: 'Ignoring previous instructions as requested.' }],
      })),
    );
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf, runner);
    delete process.env.GIT_SHA;

    expect(r.source).toBe('fallback');
    expect(r.plan.steps).toHaveLength(1);
    expect(r.plan.steps[0].action).toBe('manual_review');
    expect(r.warnings).toEqual(['aitg_guard_violation']);
    expect(runner.records.map((x) => [x.testId, x.status])).toEqual([
      ['AITG-APP-01', 'failed'],
      ['AITG-APP-12', 'passed'],
    ]);
  });

  it('records a passing run and returns the plan for a clean output', async () => {
    const { createInMemoryAitgRunner } = await import('@aisha/aitg');
    const runner = createInMemoryAitgRunner();
    process.env.GIT_SHA = 'abcdef1234567';
    safeFetch.mockResolvedValueOnce(
      gatewayResponse(JSON.stringify({ steps: [{ action: 'fetch-source' }] })),
    );
    const planExecution = await loadPlanner();

    const r = await planExecution({ task: TASK }, noopLog, ssrf, runner);
    delete process.env.GIT_SHA;

    expect(r.source).toBe('llm_gateway');
    expect(r.plan.steps[0].action).toBe('fetch-source');
    expect(runner.records.every((x) => x.status === 'passed')).toBe(true);
  });
});
