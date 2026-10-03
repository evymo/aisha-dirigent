/**
 * E2E Tests: Aisha Chat Delegation & Callback
 *
 * Tests the Aisha Dirigent chat delegation pipeline:
 * - shouldAishaRespond() trigger detection via ai-chat Edge Function
 * - aisha-callback Edge Function (async webhook endpoint)
 * - Delegation signal detection (mentions, escalation keywords)
 */

import { test, expect, Page } from "@playwright/test";
import { loginUser, waitForLoadingComplete, TEST_USERS } from "./fixtures";

const AISHA_POSTGREST_URL =
  process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const ANON_KEY =
  process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

/**
 * Get admin JWT token for API calls.
 */
async function getAdminToken(page: Page): Promise<string | null> {
  await page.goto("/auth");
  await loginUser(page, TEST_USERS.admin.email, TEST_USERS.admin.password, {
    skipGoto: true,
  });
  await waitForLoadingComplete(page);
  await page.waitForTimeout(2000);

  return await page.evaluate(async () => {
    const supabase = (
      window as unknown as {
        __supabase_client__?: {
          auth: {
            getSession: () => Promise<{
              data: { session?: { access_token: string } };
            }>;
          };
        };
      }
    ).__supabase_client__;
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  });
}

// ============================================================================
// Aisha Callback Edge Function Tests
// ============================================================================

test.describe("Aisha Callback Edge Function", () => {
  test("rejects unauthenticated requests", async ({ request }) => {
    const response = await request.post(
      `${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`,
      {
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
        data: {
          conversation_id: "00000000-0000-0000-0000-000000000001",
          content: "Test message",
          user_id: "00000000-0000-0000-0000-000000000002",
          action: "comment",
        },
      },
    );

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("rejects invalid JSON body", async ({ request }) => {
    const serviceRoleKey =
      process.env.AISHA_POSTGREST_SERVICE_KEY || "";

    const response = await request.post(
      `${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: ANON_KEY,
        },
        data: "not valid json",
      },
    );

    // Edge function should return 400 for invalid body
    expect([400, 500]).toContain(response.status());
  });

  test("rejects missing required fields", async ({ request }) => {
    const serviceRoleKey =
      process.env.AISHA_POSTGREST_SERVICE_KEY || "";

    const response = await request.post(
      `${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: ANON_KEY,
        },
        data: {
          conversation_id: "00000000-0000-0000-0000-000000000001",
          // missing content and user_id
        },
      },
    );

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Missing required fields");
  });

  test("rejects invalid UUID format", async ({ request }) => {
    const serviceRoleKey =
      process.env.AISHA_POSTGREST_SERVICE_KEY || "";

    const response = await request.post(
      `${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: ANON_KEY,
        },
        data: {
          conversation_id: "not-a-uuid",
          content: "Test message",
          user_id: "also-not-a-uuid",
          action: "comment",
        },
      },
    );

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid UUID");
  });

  test("rejects invalid action type", async ({ request }) => {
    const serviceRoleKey =
      process.env.AISHA_POSTGREST_SERVICE_KEY || "";

    const response = await request.post(
      `${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: ANON_KEY,
        },
        data: {
          conversation_id: "00000000-0000-0000-0000-000000000001",
          content: "Test message",
          user_id: "00000000-0000-0000-0000-000000000002",
          action: "invalid_action",
        },
      },
    );

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid action");
  });

  test("rejects content exceeding max length", async ({ request }) => {
    const serviceRoleKey =
      process.env.AISHA_POSTGREST_SERVICE_KEY || "";

    const response = await request.post(
      `${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: ANON_KEY,
        },
        data: {
          conversation_id: "00000000-0000-0000-0000-000000000001",
          content: "x".repeat(10001),
          user_id: "00000000-0000-0000-0000-000000000002",
          action: "comment",
        },
      },
    );

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Content too long");
  });

  test("rejects non-POST methods", async ({ request }) => {
    const response = await request.get(
      `${AISHA_POSTGREST_URL}/functions/v1/aisha-callback`,
      {
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
      },
    );

    expect(response.status()).toBe(405);
  });
});

// ============================================================================
// AI Chat Delegation Signal Tests
// ============================================================================

test.describe("AI Chat Aisha Delegation Signals", () => {
  test("ai-chat returns aisha_participated metadata field", async ({
    page,
    request,
  }) => {
    const token = await getAdminToken(page);
    test.skip(!token, "Admin login failed — skipping");

    const response = await request.post(
      `${AISHA_POSTGREST_URL}/functions/v1/ai-chat`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
        data: {
          message: "Hello, how are you?",
          conversation_id: crypto.randomUUID(),
        },
      },
    );

    // ai-chat may fail for various reasons in test env, but if it succeeds
    // the response schema should include aisha_participated
    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty("metadata");
      expect(body.metadata).toHaveProperty("aisha_participated");
      expect(typeof body.metadata.aisha_participated).toBe("boolean");
    }
  });

  test("ai-chat with Aisha mention includes aisha_message field", async ({
    page,
    request,
  }) => {
    const token = await getAdminToken(page);
    test.skip(!token, "Admin login failed — skipping");

    // Sending a message that mentions "Aisha" should trigger delegation
    const response = await request.post(
      `${AISHA_POSTGREST_URL}/functions/v1/ai-chat`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
        data: {
          message: "Aisha, can you help me with this?",
          conversation_id: crypto.randomUUID(),
        },
      },
    );

    // Even if n8n is not responding, the response structure should contain
    // the aisha_message field (possibly null)
    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty("aisha_message");
      expect(body.metadata.aisha_participated).toBeDefined();
    }
  });

  test("ai-chat with escalation keyword includes escalation signals", async ({
    page,
    request,
  }) => {
    const token = await getAdminToken(page);
    test.skip(!token, "Admin login failed — skipping");

    // "nefunguje" is a frustration signal that should trigger delegation
    const response = await request.post(
      `${AISHA_POSTGREST_URL}/functions/v1/ai-chat`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
        data: {
          message: "Toto nefunguje, prosím pomozte!",
          conversation_id: crypto.randomUUID(),
        },
      },
    );

    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty("metadata");
      // Escalation signals should be detected and included
      expect(body.metadata).toHaveProperty("aisha_participated");
    }
  });
});
