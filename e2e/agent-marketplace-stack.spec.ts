/**
 * E2E: Agent marketplace through the REAL stack (Keycloak → gateway → PostgREST).
 *
 * Proves the whole agent-marketplace flow works end-to-end against running
 * services with real auth — not just direct DB RPC calls:
 *
 *   certified partner  → submit_plugin + publish_agent
 *   admin              → review_moderation_item('approved')  (→ materialize_agent_runtime)
 *   discover           → get_available_plugins(kind='agent') lists it
 *   call-mode          → route_task(constraints.agent_slug) routes to it (primary)
 *   run-as-story       → install_agent_as_story mints the consumer's story
 *
 * Every call goes Keycloak-token → gateway (/rest/v1/rpc) → PostgREST → RPC, so
 * the auth chain (RS256 verify + HS256 PostgREST mint), RLS, and grants are all
 * exercised. (route_task is also what svc-ai-chat /router thinly forwards to.)
 *
 * Brought up + run via: `npm run test:e2e e2e/agent-marketplace-stack.spec.ts`
 */
import { test, expect, TEST_USERS, loginUser } from "./fixtures";
import type { Page } from "@playwright/test";

const GW = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const ANON = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";
const PARTNER_PROFILE_ID = "e2e00000-0000-0000-0000-000000000003";
const AGENT_SLUG = "e2e-mktpl-agent";

type RpcResult<T> = { status: number; data: T };

async function rpc<T = unknown>(
  page: Page,
  fn: string,
  params: Record<string, unknown>,
  token: string,
): Promise<RpcResult<T>> {
  const r = await page.request.post(`${GW}/rest/v1/rpc/${fn}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: params,
  });
  return { status: r.status(), data: (await r.json().catch(() => null)) as T };
}

async function tokenFor(page: Page, email: string, password: string): Promise<string> {
  await loginUser(page, email, password);
  // installAuthState writes the raw access token here (e2e/fixtures.ts).
  const token = await page.evaluate(() => window.localStorage.getItem("aisha-e2e-auth-token"));
  expect(token, `no token for ${email}`).toBeTruthy();
  return token as string;
}

test.describe("Agent marketplace — real stack (KC → gateway → PostgREST)", () => {
  test("certified member publishes; admin approves+materializes; agent is discoverable, routable, installable", async ({ page }) => {
    const partnerToken = await tokenFor(page, TEST_USERS.partner.email, TEST_USERS.partner.password);
    const adminToken = await tokenFor(page, TEST_USERS.admin.email, TEST_USERS.admin.password);

    // ── 1. PUBLISH (certified partner) ──
    const submit = await rpc<{ plugin_id?: string }>(page, "submit_plugin", {
      p_artifact_sha256: null,
      p_artifact_url: null,
      p_manifest: {
        id: AGENT_SLUG,
        version: "1.0.0",
        kind: "agent",
        name: "E2E Marketplace Agent",
        description: "end-to-end stack test agent",
        capabilities: ["agent.run_as_story"],
        lifecycle: { load_strategy: "hot" },
        agent_spec: { purpose: "e2e stack agent", default_model: "balanced", knowledge_items: [] },
      },
    }, partnerToken);
    expect(submit.status, JSON.stringify(submit.data)).toBe(200);
    const pluginId = submit.data?.plugin_id;
    expect(pluginId).toBeTruthy();

    const publish = await rpc<{ status?: string; queue_id?: string }>(
      page,
      "publish_agent",
      { p_plugin_id: pluginId },
      partnerToken,
    );
    expect(publish.status, JSON.stringify(publish.data)).toBe(200);
    expect(publish.data?.status).toBe("review");
    const queueId = publish.data?.queue_id;
    expect(queueId).toBeTruthy();

    // ── 2. APPROVE (admin) → materialize ──
    const review = await rpc(page, "review_moderation_item", {
      p_decision: "approved", p_notes: "e2e approve", p_queue_id: queueId,
    }, adminToken);
    expect(review.status, JSON.stringify(review.data)).toBe(200);

    // ── 3. DISCOVER ──
    const list = await rpc<Array<{ slug?: string }>>(
      page,
      "get_available_plugins",
      { p_kind: "agent", p_tenant_id: null },
      partnerToken,
    );
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data) && list.data.some((p) => p.slug === AGENT_SLUG)).toBe(true);

    // ── 4. CALL-MODE: route_task routes to the agent as primary ──
    const route = await rpc<{ agents?: Array<{ slug?: string }> }>(page, "route_task", {
      p_task_kind: "chat", p_risk_profile: "low", p_domain: [], p_tech: [], p_story_id: null,
      p_constraints: { agent_slug: AGENT_SLUG },
    }, partnerToken);
    expect(route.status, JSON.stringify(route.data)).toBe(200);
    expect(route.data?.agents?.[0]?.slug).toBe(AGENT_SLUG);

    // ── 5. RUN-AS-STORY: consumer installs ──
    const install = await rpc<{ story_id?: string }>(page, "install_agent_as_story", {
      p_partner_id: PARTNER_PROFILE_ID, p_plugin_id: pluginId, p_title: "E2E Installed Agent Story",
    }, partnerToken);
    expect(install.status, JSON.stringify(install.data)).toBe(200);
    expect(install.data?.story_id).toBeTruthy();
  });
});
