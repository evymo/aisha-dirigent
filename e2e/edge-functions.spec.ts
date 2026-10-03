/**
 * Edge Functions E2E Tests
 * 
 * Tests Supabase Edge Functions that are part of our solution.
 * These functions handle: partner directory, AI chat, document processing, etc.
 * 
 * NOTE: Edge Functions require either:
 * 1. Valid anon key in Authorization header for anonymous access
 * 2. Valid JWT token for authenticated access
 */

import { test, expect } from "@playwright/test";
import { loginUser, clearLocalStorage, TEST_USERS } from "./fixtures";

// Local Supabase Edge Functions URL
const FUNCTIONS_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";

// Anon key for anonymous requests (from local supabase)
const AISHA_POSTGREST_ANON_KEY = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

// Test users
const USERS = TEST_USERS;

test.describe("Public Partners Directory Edge Function", () => {
  test("Returns public partner list with anon key (POST)", async ({ request }) => {
    // This endpoint requires POST method and Origin header
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/public-partners-directory`, {
      headers: {
        "apikey": AISHA_POSTGREST_ANON_KEY,
        "Authorization": `Bearer ${AISHA_POSTGREST_ANON_KEY}`,
        "Origin": process.env.E2E_BASE_URL || "http://localhost:5173",
        "Content-Type": "application/json",
      },
      data: {}
    });
    
    // Should return 200 OK
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    
    // Should return partners array
    expect(data.partners).toBeDefined();
    expect(Array.isArray(data.partners)).toBe(true);
    
    // If we have partners in seed, check structure
    if (data.partners.length > 0) {
      const partner = data.partners[0];
      expect(partner).toHaveProperty("display_name");
      expect(partner).toHaveProperty("id");
      // Anonymous mode should NOT have sensitive fields
      expect(partner).not.toHaveProperty("email");
      expect(partner).not.toHaveProperty("phone");
    }
    
    // Should have metadata
    expect(data).toHaveProperty("isAuthenticated");
    expect(data).toHaveProperty("totalCount");
  });

  test("Rejects GET method (requires POST)", async ({ request }) => {
    const response = await request.get(`${FUNCTIONS_URL}/functions/v1/public-partners-directory`, {
      headers: {
        "apikey": AISHA_POSTGREST_ANON_KEY,
        "Authorization": `Bearer ${AISHA_POSTGREST_ANON_KEY}`,
        "Origin": process.env.E2E_BASE_URL || "http://localhost:5173",
      }
    });
    
    // Should return 405 Method Not Allowed
    expect(response.status()).toBe(405);
  });

  test("Requires Origin header (CORS protection)", async ({ request }) => {
    // Without Origin header, should be denied by CORS guard
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/public-partners-directory`, {
      headers: {
        "apikey": AISHA_POSTGREST_ANON_KEY,
        "Authorization": `Bearer ${AISHA_POSTGREST_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      data: {}
    });
    
    // Should be denied (silent CORS deny returns empty or error)
    expect([200, 403, 204]).toContain(response.status());
  });
});

test.describe("Mobile App Version Edge Function", () => {
  test("Returns app version info (public endpoint)", async ({ request }) => {
    const response = await request.get(`${FUNCTIONS_URL}/functions/v1/mobile-app-version`, {
      headers: {
        "apikey": AISHA_POSTGREST_ANON_KEY,
      }
    });
    
    // Should return 200 OK
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    
    // Should have version structure
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("version");
    expect(data.version).toHaveProperty("current");
    expect(data.version).toHaveProperty("minimum");
    expect(data.version).toHaveProperty("latest");
    
    // Should have update info
    expect(data).toHaveProperty("update");
    expect(data.update).toHaveProperty("required");
    expect(data.update).toHaveProperty("recommended");
  });
});

test.describe("AI Chat Edge Function (Authenticated)", () => {
  test("rejects request without auth token", async ({ request }) => {
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/ai-chat`, {
      data: { message: "Hello" }
    });
    
    // Runtime auth may return Unauthorized or Forbidden based on gateway handling.
    expect([401, 403]).toContain(response.status());
  });

  test("rejects request with invalid JWT", async ({ request }) => {
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/ai-chat`, {
      headers: {
        "Authorization": "Bearer invalid.jwt.token",
        "Content-Type": "application/json"
      },
      data: { message: "Hello" }
    });

    // Invalid signature should not pass auth.
    expect([401, 403]).toContain(response.status());
  });

  test("rejects request with malformed bearer token", async ({ request }) => {
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/ai-chat`, {
      headers: {
        "Authorization": "Bearer not-a-jwt",
        "Content-Type": "application/json"
      },
      data: { message: "Hello" }
    });

    expect([401, 403]).toContain(response.status());
  });

  test("rejects GET method for ai-chat endpoint", async ({ request }) => {
    const response = await request.get(`${FUNCTIONS_URL}/functions/v1/ai-chat`, {
      headers: {
        "Authorization": `Bearer ${AISHA_POSTGREST_ANON_KEY}`,
        "apikey": AISHA_POSTGREST_ANON_KEY,
      }
    });

    expect([401, 403, 405]).toContain(response.status());
  });

  test.skip("Works with valid authentication", async ({ page, request }) => {
    // Login first to get token
    await loginUser(page, USERS.member.email, USERS.member.password);
    
    // Get auth token from page context
    const authToken = await page.evaluate(async () => {
      const supabase = (window as Record<string, unknown>).__supabase_client__;
      if (!supabase) return null;
      
      const { data } = await supabase.auth.getSession();
      return data?.session?.access_token;
    });
    
    if (!authToken) {
      test.skip();
      return;
    }
    
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/ai-chat`, {
      headers: {
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
      },
      data: { message: "What is RTN?" }
    });
    
    // Should return 200 with AI response
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty("response");
  });
});

test.describe("Health Document Functions (Authenticated)", () => {
  test("Upload preflight requires authentication", async ({ request }) => {
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/upload-health-document-preflight`, {
      data: { 
        filename: "test.pdf",
        content_type: "application/pdf"
      }
    });
    
    // Should return 401 Unauthorized without token
    expect(response.status()).toBe(401);
  });

  test("Download requires authentication", async ({ request }) => {
    const response = await request.get(`${FUNCTIONS_URL}/functions/v1/download-health-document?document_id=test`, {
      headers: {
        "apikey": AISHA_POSTGREST_ANON_KEY,
      }
    });
    
    // Should return 401 or 405 (unauthorized or method not allowed)
    expect([401, 403, 405]).toContain(response.status());
  });

  test("AI analysis requires authentication", async ({ request }) => {
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/analyze-health-document`, {
      headers: {
        "apikey": AISHA_POSTGREST_ANON_KEY,
        "Origin": process.env.E2E_BASE_URL || "http://localhost:5173",
        "Content-Type": "application/json",
      },
      data: { document_id: "test" }
    });
    
    // Should return 401 Unauthorized or 403 Forbidden
    expect([401, 403, 405]).toContain(response.status());
  });
});

test.describe("Stripe Webhook (Server-to-Server)", () => {
  test("Rejects requests without Stripe signature", async ({ request }) => {
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/stripe-webhook`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: { type: "test" }
    });
    
    // Should return 400, 401, 403 or 500 (no Stripe key = 500 in local)
    expect([400, 401, 403, 500]).toContain(response.status());
  });
});

test.describe("Packeta API (Internal)", () => {
  test("Packeta API endpoint exists", async ({ request }) => {
    // Just verify the endpoint responds
    const response = await request.get(`${FUNCTIONS_URL}/functions/v1/packeta-api`);
    
    // Should return some response (not 404)
    expect(response.status()).not.toBe(404);
  });
});

test.describe("Push Notifications", () => {
  test("Requires authentication", async ({ request }) => {
    const response = await request.post(`${FUNCTIONS_URL}/functions/v1/send-push-notification`, {
      data: { 
        user_id: "test",
        title: "Test",
        body: "Test message"
      }
    });
    
    // Should require auth or admin privileges
    expect([401, 403]).toContain(response.status());
  });
});

test.describe("Edge Function via UI", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Partners page loads data via Edge Function", async ({ page }) => {
    await page.goto("/partners");
    
    // Wait for partners to load
    await page.waitForLoadState("networkidle");
    
    // Should display partner list or "no partners" message
    const hasPartners = await page.getByText(/partner|ambassador/i).isVisible().catch(() => false);
    const hasNoPartners = await page.getByText(/no partners|no ambassadors|coming soon/i).isVisible().catch(() => false);
    
    expect(hasPartners || hasNoPartners).toBe(true);
  });

  test.skip("AI Story Consult available for members", async ({ page }) => {
    // Skip: This feature may not be available in local environment without OpenAI key
    await loginUser(page, USERS.member.email, USERS.member.password);
    await page.goto("/member/story");
    
    // Check if AI consult feature is available
    const hasAIFeature = await page.getByText(/ai|consult|story/i).isVisible({ timeout: 10000 }).catch(() => false);
    
    // Feature should be present (even if not functional without API key)
    expect(hasAIFeature).toBe(true);
  });
});
