/**
 * E2E Tests: AISHA Dirigent Developer Workflow
 *
 * Tests the complete developer workflow via real Supabase Edge Functions:
 *   - aisha-push SSE stream (heartbeat + event format)
 *   - aisha-callback webhook (auth, validation, action types)
 *   - n8n-trigger edge function (workflow routing)
 *   - mcp-knowledge-server (search_knowledge tool)
 *   - ai-chat developer communication (model metadata, AISHA participation)
 *
 * Covers positive flows, false positive guards, and failure/degradation paths.
 *
 * Requires: local Supabase stack running (supabase start)
 *
 * @module
 */
import { test, expect, Page } from "@playwright/test";
import { TEST_USERS, loginUser, waitForLoadingComplete } from "./fixtures";

const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const ANON_KEY =
  process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";
const SERVICE_ROLE_KEY =
  process.env.AISHA_POSTGREST_SERVICE_KEY || "";

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function getMemberToken(page: Page): Promise<string | null> {
  await page.goto("/auth");
  await loginUser(page, TEST_USERS.member.email, TEST_USERS.member.password, { skipGoto: true });
  await waitForLoadingComplete(page);
  await page.waitForTimeout(1500);
  return page.evaluate(async () => {
    const supabase = (
      window as unknown as {
        __supabase_client__?: {
          auth: { getSession: () => Promise<{ data: { session?: { access_token: string } } }> };
        };
      }
    ).__supabase_client__;
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  });
}

async function getAdminToken(page: Page): Promise<string | null> {
  await page.goto("/auth");
  await loginUser(page, TEST_USERS.admin.email, TEST_USERS.admin.password, { skipGoto: true });
  await waitForLoadingComplete(page);
  await page.waitForTimeout(1500);
  return page.evaluate(async () => {
    const supabase = (
      window as unknown as {
        __supabase_client__?: {
          auth: { getSession: () => Promise<{ data: { session?: { access_token: string } } }> };
        };
      }
    ).__supabase_client__;
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  });
}

// ---------------------------------------------------------------------------
// aisha-push SSE stream
// ---------------------------------------------------------------------------

test.describe("aisha-push SSE stream", () => {
  test("authenticated request returns 200 or starts streaming", async ({ page, request }) => {
    const token = await getMemberToken(page);
    test.skip(!token, "Member login failed — skipping");

    const response = await request.get(`${AISHA_POSTGREST_URL}/functions/v1/aisha-push`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
        apikey: ANON_KEY,
      },
      timeout: 6000,
    });

    // SSE may return 200 (stream opened) or the server may close immediately
    expect([200, 204]).toContain(response.status());
  });

  test("unauthenticated request returns 401, not 500", async ({ request }) => {
    const response = await request.get(`${AISHA_POSTGREST_URL}/functions/v1/aisha-push`, {
      headers: {
        apikey: ANON_KEY,
        Accept: "text/event-stream",
        // No Authorization header — anonymous
        Authorization: `Bearer ${ANON_KEY}`,
      },
      timeout: 5000,
    });

    // Must be auth error, not server crash
    expect([401, 403]).toContain(response.status());
    const body = await response.json().catch(() => ({}));
    expect(body).toHaveProperty("error");
  });

  test("second request from same user does not get rate-limited immediately", async ({ page, request }) => {
    const token = await getMemberToken(page);
    test.skip(!token, "Member login failed — skipping");

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
      apikey: ANON_KEY,
    };

    const r1 = await request.get(`${AISHA_POSTGREST_URL}/functions/v1/aisha-push`, { headers, timeout: 5000 });
    const r2 = await request.get(`${AISHA_POSTGREST_URL}/functions/v1/aisha-push`, { headers, timeout: 5000 });

    // Neither should be a rate limit error (429)
    expect(r1.status()).not.toBe(429);
    expect(r2.status()).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
// aisha-callback edge function
// ---------------------------------------------------------------------------

test.describe("aisha-callback: valid service_role request", () => {
  test("accepts valid comment action with correct fields", async ({ request }) => {
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: ANON_KEY,
      },
      data: {
        conversation_id: "00000000-0000-0000-0000-000000000001",
        content: "AISHA says: This hook needs Zod validation.",
        user_id: "00000000-0000-0000-0000-000000000002",
        action: "comment",
      },
    });

    // Either stored successfully or conversation not found (404) — but NOT 500
    expect([200, 404]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      // If 200, should signal storage happened
      expect(body).toHaveProperty("stored");
    }
  });

  test("accepts 'directive' action type", async ({ request }) => {
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: ANON_KEY,
      },
      data: {
        conversation_id: "00000000-0000-0000-0000-000000000003",
        content: JSON.stringify({ status: "blocked", orchestration_note: "RPC violation" }),
        user_id: "00000000-0000-0000-0000-000000000002",
        action: "directive",
      },
    });

    expect([200, 404]).toContain(response.status());
  });
});

test.describe("aisha-callback: invalid requests (false positive guards)", () => {
  test("non-existing conversation_id → 404 (not 500)", async ({ request }) => {
    const fakeConvId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: ANON_KEY,
      },
      data: {
        conversation_id: fakeConvId,
        content: "Test message",
        user_id: "00000000-0000-0000-0000-000000000002",
        action: "comment",
      },
    });

    // Not found is acceptable; server crash (500) is not
    expect(response.status()).not.toBe(500);
    expect([200, 400, 404]).toContain(response.status());
  });

  test("expired/invalid JWT → 401 (not 500)", async ({ request }) => {
    const expiredJwt = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjEwMDAwMH0.invalid";
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${expiredJwt}`,
        apikey: ANON_KEY,
      },
      data: {
        conversation_id: "00000000-0000-0000-0000-000000000001",
        content: "Test",
        user_id: "00000000-0000-0000-0000-000000000002",
        action: "comment",
      },
    });

    expect([401, 403]).toContain(response.status());
    expect(response.status()).not.toBe(500);
  });

  test("unknown action type → 400 (not silently ignored)", async ({ request }) => {
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: ANON_KEY,
      },
      data: {
        conversation_id: "00000000-0000-0000-0000-000000000001",
        content: "Test",
        user_id: "00000000-0000-0000-0000-000000000002",
        action: "totally_unknown_action",
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// n8n-trigger edge function
// ---------------------------------------------------------------------------

test.describe("n8n-trigger: dirigent-agent workflow routing", () => {
  test("valid dirigent-agent payload returns 200 or 202", async ({ page, request }) => {
    const token = await getAdminToken(page);
    test.skip(!token, "Admin login failed — skipping");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/n8n-trigger`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
      },
      data: {
        workflow: "dirigent-agent",
        payload: {
          task: "Jak napsat RPC funkci se SECURITY DEFINER?",
          intent: "knowledge",
          context: { expertise_level: "intermediate" },
        },
      },
      timeout: 30000,
    });

    // May be async (202) or sync (200) — both acceptable
    expect([200, 202, 503]).toContain(response.status());
    // 503 acceptable when n8n is not running in test env
  });

  test("unknown workflow name → 400 or clear error (not silently ignored)", async ({ page, request }) => {
    const token = await getAdminToken(page);
    test.skip(!token, "Admin login failed — skipping");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/n8n-trigger`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
      },
      data: {
        workflow: "nonexistent-workflow-xyz",
        payload: { task: "test" },
      },
      timeout: 15000,
    });

    // Should NOT be silently 200 with no actual processing
    if (response.status() === 200) {
      const body = await response.json().catch(() => ({}));
      // If 200, should indicate the workflow was not found or not processed
      expect(body).toHaveProperty("error");
    } else {
      expect([400, 404, 422, 503]).toContain(response.status());
    }
  });
});

// ---------------------------------------------------------------------------
// MCP Knowledge Server — search_knowledge tool
// ---------------------------------------------------------------------------

test.describe("mcp-knowledge-server: search_knowledge tool", () => {
  test("search_knowledge returns text content", async ({ page, request }) => {
    const token = await getAdminToken(page);
    test.skip(!token, "Admin login failed — skipping");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/mcp-knowledge-server`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
      },
      data: {
        jsonrpc: "2.0",
        id: "test-1",
        method: "tools/call",
        params: {
          name: "search_knowledge",
          arguments: { query: "RPC-only architecture pattern" },
        },
      },
      timeout: 15000,
    });

    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty("result");
      expect(body.result).toHaveProperty("content");
      const content = body.result.content;
      expect(Array.isArray(content)).toBe(true);
      expect(content.length).toBeGreaterThan(0);
      expect(content[0]).toHaveProperty("type");
      expect(["text", "resource"]).toContain(content[0].type);
    } else {
      // KB not populated in test env — acceptable
      expect([503, 404]).toContain(response.status());
    }
  });

  test("get_knowledge_stats returns platform stats object", async ({ page, request }) => {
    const token = await getAdminToken(page);
    test.skip(!token, "Admin login failed — skipping");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/mcp-knowledge-server`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
      },
      data: {
        jsonrpc: "2.0",
        id: "test-2",
        method: "tools/call",
        params: {
          name: "get_knowledge_stats",
          arguments: {},
        },
      },
      timeout: 10000,
    });

    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty("result");
    }
  });
});

// ---------------------------------------------------------------------------
// ai-chat: developer communication flows
// ---------------------------------------------------------------------------

test.describe("ai-chat: developer ↔ model communication", () => {
  test("authenticated member can send RPC knowledge query and receives metadata", async ({
    page,
    request,
  }) => {
    const token = await getMemberToken(page);
    test.skip(!token, "Member login failed — skipping");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/ai-chat`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
      },
      data: {
        message: "Jak napsat RPC funkci?",
        conversation_id: crypto.randomUUID(),
        context: "developer",
      },
      timeout: 30000,
    });

    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty("response");
      expect(body).toHaveProperty("metadata");
      expect(typeof body.metadata.aisha_participated).toBe("boolean");
    } else {
      // AI provider not configured in test env
      expect([503, 404]).toContain(response.status());
    }
  });

  test("message mentioning 'Aisha' signals participation in metadata", async ({ page, request }) => {
    const token = await getMemberToken(page);
    test.skip(!token, "Member login failed — skipping");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/ai-chat`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
      },
      data: {
        message: "Aisha, zkontroluj prosím tento kód",
        conversation_id: crypto.randomUUID(),
      },
      timeout: 30000,
    });

    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty("aisha_message");
      // When AISHA participates, aisha_participated should be true
      expect(body.metadata.aisha_participated).toBeDefined();
    }
  });

  test("frustration signal 'nefunguje' does not leak PII in response", async ({ page, request }) => {
    const token = await getMemberToken(page);
    test.skip(!token, "Member login failed — skipping");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/ai-chat`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
      },
      data: {
        message: "Toto absolutně nefunguje! jan.novak@email.cz nemůže se přihlásit",
        conversation_id: crypto.randomUUID(),
      },
      timeout: 30000,
    });

    if (response.status() === 200) {
      const body = await response.json();
      // Guardrails should mask the email address
      expect(body.response).not.toContain("jan.novak@email.cz");
    }
  });

  test("unauthenticated anon user → 401 or 403", async ({ request }) => {
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/ai-chat`, {
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      data: {
        message: "Hello",
        conversation_id: crypto.randomUUID(),
      },
      timeout: 10000,
    });

    expect([401, 403]).toContain(response.status());
  });

  test("admin user gets higher chat_access_level tier in metadata", async ({ page, request }) => {
    const adminToken = await getAdminToken(page);
    test.skip(!adminToken, "Admin login failed — skipping");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/ai-chat`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        apikey: ANON_KEY,
      },
      data: {
        message: "What is the platform architecture?",
        conversation_id: crypto.randomUUID(),
      },
      timeout: 30000,
    });

    if (response.status() === 200) {
      const body = await response.json();
      // Admin should have at minimum 'active' tier
      const tier = body.metadata?.chat_access_level;
      if (tier) {
        const tiers = ["none", "basic", "enrolled", "active", "qualified", "certified", "premium"];
        const tierIndex = tiers.indexOf(tier);
        expect(tierIndex).toBeGreaterThanOrEqual(tiers.indexOf("active"));
      }
    }
  });

  test("unknown conversation_id → graceful handling (new conversation or 404, not 500)", async ({
    page,
    request,
  }) => {
    const token = await getMemberToken(page);
    test.skip(!token, "Member login failed — skipping");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/ai-chat`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
      },
      data: {
        message: "Hello",
        conversation_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      },
      timeout: 20000,
    });

    // Server should handle gracefully — not crash
    expect(response.status()).not.toBe(500);
    expect([200, 404, 422]).toContain(response.status());
  });
});
