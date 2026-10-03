/**
 * E2E: Workbench surfacing — agent activity + spend governance.
 *
 * The verification loop the workbench analytics need, end-to-end against the
 * local stack: MUTATE the backend via an audited RPC, then MEASURE that the
 * change shows up where operators look — Mission Control panes (web), the
 * shared RPCs the Appsmith dashboard reads, and the spend-governance decision.
 *
 *   Scenario A — agent_live_sessions surfaces in Mission Control
 *     mutate: fn_upsert_agent_live_session  →  verify: AgentSessionsStrip row
 *   Scenario B — the same row is what the Appsmith dashboard would render
 *     verify: list_active_agent_sessions (dashboard's query) returns it
 *   Scenario C — spend governance decides ask/deny from a user policy
 *     mutate: set_ai_spend_policy_audited  →  measure: fn_authorize_task_spend
 *
 * Parameterised by AISHA_POSTGREST_URL — point it at any backend (the
 * workbench scenarios run against the dev stack by default).
 *
 * Run: npm run test:e2e -- workbench-surfacing.spec.ts
 */
import { test, expect, TEST_USERS, loginUser, waitForLoadingComplete } from "./fixtures";
import type { Page } from "@playwright/test";

const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const ANON_KEY = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

async function rpc<T = unknown>(
  page: Page,
  fn: string,
  params: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: T }> {
  const res = await page.request.post(`${AISHA_POSTGREST_URL}/rest/v1/rpc/${fn}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: params,
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function accessToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    // The e2e auth fixture (installAuthState) writes the raw KC access token
    // here as a plain string — the canonical, serialisation-agnostic source.
    const direct = window.localStorage.getItem("aisha-e2e-auth-token");
    if (typeof direct === "string" && direct.length > 20) return direct;
    // Fallback: oidc-client-ts serialises the signed-in user as JSON under
    // `oidc.user:<authority>:<clientId>`, with access_token at the top level.
    for (const k of Object.keys(window.localStorage)) {
      try {
        const v = JSON.parse(window.localStorage.getItem(k) ?? "");
        const t = v?.access_token ?? v?.currentSession?.access_token ?? v?.session?.access_token;
        if (typeof t === "string" && t.length > 20) return t;
      } catch {
        /* not JSON — e.g. the raw-token keys handled above */
      }
    }
    return "";
  });
}

test.describe("Workbench: agent activity + spend governance", () => {
  test("A+B: live agent session surfaces in Mission Control and the dashboard RPC", async ({
    page,
  }) => {
    await page.goto("/");
    await loginUser(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
    const token = await accessToken(page);
    expect(token, "expected access token after login").not.toEqual("");

    const sessionId = `e2e-${Date.now()}`;

    // MUTATE: create a live agent session (source distinguishes it from real ones).
    const upsert = await rpc(page, "fn_upsert_agent_live_session", {
      p_session_id: sessionId,
      p_source: "e2e-test",
      p_phase: "tool_use",
      p_last_tool: "Edit",
      p_last_file: "e2e/workbench-surfacing.spec.ts",
    }, token);
    expect(upsert.status, JSON.stringify(upsert.body)).toBe(200);

    try {
      // MEASURE (B): the RPC the Appsmith dashboard + Dirigent IDE view read.
      const list = await rpc<Array<{ session_id: string; source: string; current_phase: string }>>(
        page,
        "list_active_agent_sessions",
        { p_limit: 50 },
        token,
      );
      expect(list.status).toBe(200);
      const seeded = (list.body ?? []).find((s) => s.session_id === sessionId);
      expect(seeded, "seeded session should be returned by list_active_agent_sessions").toBeTruthy();
      expect(seeded?.source).toBe("e2e-test");
      expect(seeded?.current_phase).toBe("tool_use");

      // VERIFY (A): the web Mission Control AgentSessionsStrip renders it.
      await page.goto("/admin/mission-control");
      await waitForLoadingComplete(page);
      const strip = page.locator('[data-test="mc-agent-sessions-strip"]');
      await expect(strip).toBeVisible();
      // Realtime + query refetch — poll the row in for a few seconds.
      await expect(page.locator(`[data-test="agent-session-${sessionId}"]`)).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      // Cleanup: stop the session so it leaves the active set.
      await rpc(page, "fn_upsert_agent_live_session", {
        p_session_id: sessionId,
        p_source: "e2e-test",
        p_phase: "stopped",
      }, token);
    }
  });

  test("C: spend policy drives the authorize decision (ask/deny)", async ({ page }) => {
    await page.goto("/");
    await loginUser(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
    const token = await accessToken(page);
    expect(token).not.toEqual("");

    // MUTATE: a global rule that denies anything above $0.01 for this kind.
    const setPolicy = await rpc(page, "set_ai_spend_policy_audited", {
      p_scope_type: "global",
      p_task_kind: "project_delivery",
      p_auto_allow_under_usd: 0.01,
      p_ask_over_usd: 0.01,
      p_deny_over_usd: 0.02,
    }, token);
    expect(setPolicy.status, JSON.stringify(setPolicy.body)).toBe(200);

    try {
      // MEASURE: the authorizer must now refuse a project_delivery task
      // (catalog p90 for that kind is dollars, far above the $0.02 ceiling).
      const authz = await rpc<{ decision: string; estimate?: unknown }>(
        page,
        "fn_authorize_task_spend",
        { p_kind: "project_delivery" },
        token,
      );
      expect(authz.status, JSON.stringify(authz.body)).toBe(200);
      expect(["ask", "deny"]).toContain(authz.body?.decision);
    } finally {
      // Cleanup: deactivate the test policy.
      await rpc(page, "set_ai_spend_policy_audited", {
        p_scope_type: "global",
        p_task_kind: "project_delivery",
        p_deactivate: true,
      }, token);
    }
  });
});
