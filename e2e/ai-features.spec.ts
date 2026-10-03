/**
 * E2E Tests: AI Features & OpenAI Integration
 * 
 * Tests AI-related Edge Functions including:
 * - OpenAI API key configuration (admin only)
 * - AI Chat functionality
 * - Document AI analysis
 * 
 * Uses OPENAI_API_KEY from .env for testing
 */

import { test, expect, Page } from "@playwright/test";
import { loginUser, waitForLoadingComplete, TEST_USERS } from "./fixtures";

// Test configuration from environment
const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ANON_KEY = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

/**
 * Get admin JWT token for API calls
 */
async function getAdminToken(page: Page): Promise<string | null> {
  await page.goto("/auth");
  await loginUser(page, TEST_USERS.admin.email, TEST_USERS.admin.password, { skipGoto: true });
  await waitForLoadingComplete(page);
  
  // Wait for auth to be fully established
  await page.waitForTimeout(2000);
  
  return await page.evaluate(async () => {
    const supabase = (window as unknown as { __supabase_client__?: { auth: { getSession: () => Promise<{ data: { session?: { access_token: string } } }> } } }).__supabase_client__;
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  });
}

test.describe("OpenAI Key Configuration", () => {
  test.skip(!OPENAI_API_KEY, "Skipping: OPENAI_API_KEY not set in environment");

  test("Admin can check OpenAI key status", async ({ page, request }) => {
    const token = await getAdminToken(page);
    expect(token).toBeTruthy();

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/update-openai-key`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
      },
      data: { action: "status" }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("configured");
  });

  test("Admin can validate OpenAI key format", async ({ page, request }) => {
    const token = await getAdminToken(page);
    expect(token).toBeTruthy();

    // Test with invalid key format
    const invalidResponse = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/update-openai-key`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
      },
      data: { action: "validate", key: "invalid-key" }
    });

    expect(invalidResponse.status()).toBe(400);
    const invalidData = await invalidResponse.json();
    expect(invalidData.error).toMatch(/invalid|format/i);

    // Test with valid key format (from env)
    if (OPENAI_API_KEY.startsWith("sk-")) {
      const validResponse = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/update-openai-key`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "apikey": ANON_KEY,
        },
        data: { action: "validate", key: OPENAI_API_KEY }
      });

      expect(validResponse.status()).toBe(200);
      const validData = await validResponse.json();
      expect(validData.valid).toBe(true);
    }
  });

  test("Admin can save and update OpenAI key", async ({ page, request }) => {
    test.skip(!OPENAI_API_KEY.startsWith("sk-"), "Valid OpenAI key format required");
    
    const token = await getAdminToken(page);
    expect(token).toBeTruthy();

    // Save the key
    const saveResponse = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/update-openai-key`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
      },
      data: { action: "save", key: OPENAI_API_KEY }
    });

    expect(saveResponse.status()).toBe(200);
    const saveData = await saveResponse.json();
    expect(saveData.success).toBe(true);

    // Verify it's now configured
    const statusResponse = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/update-openai-key`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
      },
      data: { action: "status" }
    });

    expect(statusResponse.status()).toBe(200);
    const statusData = await statusResponse.json();
    expect(statusData.configured).toBe(true);
  });

  test("Non-admin cannot manage OpenAI key", async ({ page, request }) => {
    await loginUser(page, TEST_USERS.member.email, TEST_USERS.member.password);
    await waitForLoadingComplete(page);
    await page.waitForTimeout(2000);

    const token = await page.evaluate(async () => {
      const supabase = (window as unknown as { __supabase_client__?: { auth: { getSession: () => Promise<{ data: { session?: { access_token: string } } }> } } }).__supabase_client__;
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data?.session?.access_token || null;
    });

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/update-openai-key`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
      },
      data: { action: "status" }
    });

    // Should be forbidden for non-admin
    expect([401, 403]).toContain(response.status());
  });
});

test.describe("AI Chat Integration", () => {
  test("AI Chat requires authentication", async ({ request }) => {
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/ai-chat`, {
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
      },
      data: { message: "Hello" }
    });

    // Should require user authentication, not just anon key
    expect([401, 403]).toContain(response.status());
  });

  test("AI Chat responds to authenticated user", async ({ request }) => {
    // Get member token via Supabase Auth API
    const authResponse = await request.post(`${AISHA_POSTGREST_URL}/auth/v1/token?grant_type=password`, {
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
      },
      data: {
        email: TEST_USERS.member.email,
        password: TEST_USERS.member.password,
      }
    });

    expect(authResponse.status()).toBe(200);
    const authData = await authResponse.json();
    const memberToken = authData.access_token;
    expect(memberToken).toBeTruthy();

    // If OpenAI key is set, first configure it via admin
    if (OPENAI_API_KEY.startsWith("sk-")) {
      const adminAuthResponse = await request.post(`${AISHA_POSTGREST_URL}/auth/v1/token?grant_type=password`, {
        headers: {
          "Content-Type": "application/json",
          "apikey": ANON_KEY,
        },
        data: {
          email: TEST_USERS.admin.email,
          password: TEST_USERS.admin.password,
        }
      });
      
      if (adminAuthResponse.status() === 200) {
        const adminData = await adminAuthResponse.json();
        await request.post(`${AISHA_POSTGREST_URL}/functions/v1/update-openai-key`, {
          headers: {
            "Authorization": `Bearer ${adminData.access_token}`,
            "Content-Type": "application/json",
            "apikey": ANON_KEY,
          },
          data: { action: "save", key: OPENAI_API_KEY }
        });
      }
    }

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/ai-chat`, {
      headers: {
        "Authorization": `Bearer ${memberToken}`,
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
      },
      data: { 
        message: "What is RTN?",
        context: "health"
      }
    });

    // If OpenAI key is configured, should get AI response
    // If not configured, should get 503 Service Unavailable
    expect([200, 503]).toContain(response.status());

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty("response");
      expect(typeof data.response).toBe("string");
      expect(data.response.length).toBeGreaterThan(0);
    } else {
      const data = await response.json();
      expect(data.error).toMatch(/not configured|unavailable/i);
    }
  });
});
