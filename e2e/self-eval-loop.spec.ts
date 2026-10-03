/**
 * E2E: Story Self-Evaluation Loop — DEPLOYED verification
 *
 * Verifies that the self-* loop (STORY_SELF_EVALUATION_LOOP.md PR 1-5) is
 * actually FUNCTIONAL + DEPLOYED on the target stack — not just statically
 * valid. Designed to run from the svc-playwright-runner container against a
 * deployed target (production or local stack) where `PLAYWRIGHT_BASE_URL`,
 * `AISHA_GATEWAY_URL` and `POSTGREST_SERVICE_TOKEN` are injected.
 *
 * What it proves on the live stack:
 *   1. evaluate_story_self RPC returns a well-formed verdict (PR 1 deployed)
 *   2. get_story_aisha_maturity returns a scorecard (PR 1 maturity fix deployed)
 *   3. fn_get_proposals_due_outcome_review is callable (PR 5 loop-closer deployed)
 *   4. improvement_proposals.outcome column is queryable (PR 5 migration applied)
 *   5. Dirigent /dirigent/dispatch endpoint responds (PR 2 supervisor edge fn deployed)
 *
 * Auth: service_role via POSTGREST_SERVICE_TOKEN (what n8n / the runner use).
 * Skips cleanly when no service token / target is configured (e.g. plain local
 * dev), so it never false-fails — it only asserts when pointed at a real stack.
 *
 * Trigger against a deployed target (records into playwright_runs + story timeline):
 *   start_playwright_run(suite => 'e2e/self-eval-loop.spec.ts', target_base_url => 'auto', app_name => 'aisha-core', ...)
 * See docs/architecture/STORY_SELF_EVALUATION_RUNBOOK.md.
 */

import { test, expect } from "./fixtures";
import type { APIRequestContext, APIResponse } from "@playwright/test";

// ============================================================================
// CONFIGURATION (deployed-stack aware)
// ============================================================================

const RPC_PATH = "/rest/v1/rpc";

/** PostgREST/REST base — gateway proxies /rest/v1 on the deployed stack. */
function rpcBaseUrl(): string {
  return (
    process.env.VITE_AISHA_POSTGREST_URL ||
    process.env.AISHA_POSTGREST_URL ||
    process.env.AISHA_GATEWAY_URL ||
    process.env.PLAYWRIGHT_BASE_URL ||
    process.env.E2E_BASE_URL ||
    "http://127.0.0.1:57421"
  ).replace(/\/$/, "");
}

/** Gateway base for the Dirigent supervisor edge fn (/dirigent/dispatch). */
function gatewayBaseUrl(): string {
  return (
    process.env.AISHA_GATEWAY_URL ||
    process.env.VITE_AISHA_GATEWAY_URL ||
    process.env.PLAYWRIGHT_BASE_URL ||
    process.env.E2E_BASE_URL ||
    rpcBaseUrl()
  ).replace(/\/$/, "");
}

/** service_role token — injected by svc-playwright-runner; same as n8n uses. */
function serviceToken(): string | null {
  return (
    process.env.POSTGREST_SERVICE_TOKEN ||
    process.env.AISHA_SERVICE_TOKEN ||
    process.env.AISHA_POSTGREST_SERVICE_TOKEN ||
    null
  );
}

function anonKey(): string {
  return (
    process.env.VITE_AISHA_POSTGREST_ANON_KEY ||
    process.env.AISHA_POSTGREST_ANON_KEY ||
    serviceToken() ||
    ""
  );
}

interface RpcResult {
  status: number;
  data: unknown;
  error: unknown;
}

/** Call an RPC as service_role (Authorization: Bearer <service token>). */
async function callRpcService(
  request: APIRequestContext,
  functionName: string,
  params: Record<string, unknown> = {},
): Promise<RpcResult> {
  const token = serviceToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (anonKey()) headers["apikey"] = anonKey();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response: APIResponse;
  try {
    response = await request.post(`${rpcBaseUrl()}${RPC_PATH}/${functionName}`, {
      headers,
      data: params,
    });
  } catch (e) {
    return { status: 0, data: null, error: e instanceof Error ? e.message : "network error" };
  }
  const status = response.status();
  let data: unknown = null;
  let error: unknown = null;
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text);
      if (status >= 400) error = parsed;
      else data = parsed;
    }
  } catch {
    /* non-JSON */
  }
  return { status, data, error };
}

/** Resolve a story to evaluate: explicit env, else the stack-default story. */
async function resolveStoryId(request: APIRequestContext): Promise<string | null> {
  if (process.env.E2E_STORY_ID) return process.env.E2E_STORY_ID;
  const token = serviceToken();
  const headers: Record<string, string> = {};
  if (anonKey()) headers["apikey"] = anonKey();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await request.get(
      `${rpcBaseUrl()}/rest/v1/partner_stories?is_stack_default=eq.true&select=id&limit=1`,
      { headers },
    );
    if (res.status() !== 200) return null;
    const rows = (await res.json()) as Array<{ id?: string }>;
    return Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ============================================================================
// TESTS
// ============================================================================

test.describe("Self-Eval Loop — deployed stack verification", () => {
  const configured = Boolean(serviceToken());
  let storyId: string | null = null;

  test.beforeAll(async ({ request }) => {
    if (!configured) return;
    storyId = await resolveStoryId(request);
  });

  test("evaluate_story_self returns a well-formed verdict (PR1 deployed)", async ({ request }) => {
    test.skip(!configured, "No POSTGREST_SERVICE_TOKEN — not a deployed-stack run");
    test.skip(!storyId, "No stack-default story_id resolvable on target");

    const r = await callRpcService(request, "evaluate_story_self", { p_story_id: storyId });
    expect(r.status, `evaluate_story_self HTTP ${r.status}: ${JSON.stringify(r.error)}`).toBe(200);
    expect(isObject(r.data), "verdict must be a JSON object").toBe(true);
    const verdict = r.data as Record<string, unknown>;
    for (const key of ["story_id", "score", "level", "dimensions", "findings", "recommended_actions"]) {
      expect(verdict, `verdict missing key '${key}'`).toHaveProperty(key);
    }
    expect(Array.isArray(verdict.dimensions), "dimensions must be an array").toBe(true);
    expect(Array.isArray(verdict.findings), "findings must be an array").toBe(true);
    expect(["novice", "intermediate", "proficient", "expert"]).toContain(verdict.level);
  });

  test("get_story_aisha_maturity returns a scorecard (PR1 maturity fix deployed)", async ({ request }) => {
    test.skip(!configured, "No service token");
    test.skip(!storyId, "No story_id");

    const r = await callRpcService(request, "get_story_aisha_maturity", { p_story_id: storyId });
    expect(r.status, `get_story_aisha_maturity HTTP ${r.status}`).toBe(200);
    expect(isObject(r.data)).toBe(true);
    const m = r.data as Record<string, unknown>;
    expect(m).toHaveProperty("maturity_score");
    expect(m).toHaveProperty("maturity_level");
    expect(m).toHaveProperty("compliance_pass_rate");
  });

  test("fn_get_proposals_due_outcome_review is callable (PR5 loop-closer deployed)", async ({ request }) => {
    test.skip(!configured, "No service token");

    const r = await callRpcService(request, "fn_get_proposals_due_outcome_review", {
      p_window_hours: 24,
      p_limit: 5,
    });
    expect(r.status, `fn_get_proposals_due_outcome_review HTTP ${r.status}: ${JSON.stringify(r.error)}`).toBe(200);
    expect(Array.isArray(r.data), "lister must return an array").toBe(true);
  });

  test("improvement_proposals.outcome column is queryable (PR5 migration applied)", async ({ request }) => {
    test.skip(!configured, "No service token");
    const token = serviceToken();
    const headers: Record<string, string> = {};
    if (anonKey()) headers["apikey"] = anonKey();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await request.get(
      `${rpcBaseUrl()}/rest/v1/improvement_proposals?select=id,outcome&limit=1`,
      { headers },
    );
    // 200 = column exists + selectable. A 400 referencing 'outcome' = migration NOT applied.
    expect(res.status(), `improvement_proposals.outcome select HTTP ${res.status()}`).toBe(200);
  });

  test("Dirigent /dirigent/dispatch endpoint is deployed + responding (PR2)", async ({ request }) => {
    test.skip(!configured, "No service token");
    const token = serviceToken();
    let res: APIResponse;
    try {
      res = await request.post(`${gatewayBaseUrl()}/dirigent/dispatch`, {
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        data: { event: "session_start", session_id: "e2e-self-eval-probe" },
      });
    } catch (e) {
      throw new Error(`/dirigent/dispatch unreachable: ${e instanceof Error ? e.message : e}`);
    }
    // Deployed + handling requests = 200 (fail-open) or auth-gated 401/403/400 — NOT 404/5xx.
    expect(
      [200, 400, 401, 403].includes(res.status()),
      `/dirigent/dispatch returned ${res.status()} — expected a handled response (route deployed), not 404/5xx`,
    ).toBe(true);
  });
});
