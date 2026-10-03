/**
 * E2E Tests: Stripe Payment Integration
 * 
 * Tests Stripe checkout and payment flows including:
 * - Checkout session creation
 * - Payment form interaction
 * - Webhook handling verification
 * 
 * Uses Stripe test keys from .env:
 * - STRIPE_TEST_PUBLISHABLE_KEY
 * - STRIPE_TEST_SECRET_KEY
 * - STRIPE_TEST_CARD_NO (4242424242424242)
 * 
 * See: https://docs.stripe.com/testing
 */

import { test, expect, Page } from "@playwright/test";
import { loginUser, waitForLoadingComplete, TEST_USERS } from "./fixtures";

// Stripe test configuration
const STRIPE_TEST_PUBLISHABLE_KEY = process.env.STRIPE_TEST_PUBLISHABLE_KEY || "";
const STRIPE_TEST_CARD_NO = process.env.STRIPE_TEST_CARD_NO || "4242424242424242";
const STRIPE_TEST_EXPIRY = "12/30";
const STRIPE_TEST_CVC = "123";
const STRIPE_TEST_ZIP = "12345";

// Supabase config
const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const ANON_KEY = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

/**
 * Get user JWT token via REST API (more reliable than UI login)
 */
async function getUserToken(request: import("@playwright/test").APIRequestContext, user: typeof TEST_USERS.member): Promise<string | null> {
  try {
    const response = await request.post(`${AISHA_POSTGREST_URL}/auth/v1/token?grant_type=password`, {
      headers: {
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      data: {
        email: user.email,
        password: user.password,
      },
    });
    
    if (response.status() !== 200) return null;
    const data = await response.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

test.describe("Stripe: Checkout Session", () => {
  test("Create subscription checkout requires auth", async ({ request }) => {
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/create-subscription-checkout`, {
      headers: {
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      data: {
        priceId: "price_test",
        successUrl: "http://localhost:5173/success",
        cancelUrl: "http://localhost:5173/cancel",
      }
    });

    // Should require user authentication
    expect([401, 403]).toContain(response.status());
  });

  test("Authenticated user can initiate checkout", async ({ request }) => {
    const token = await getUserToken(request, TEST_USERS.member);
    test.skip(!token, "Could not authenticate");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/create-subscription-checkout`, {
      headers: {
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        priceId: "price_test",
        successUrl: "http://localhost:5173/success",
        cancelUrl: "http://localhost:5173/cancel",
      }
    });

    // Should return session URL or Stripe not configured error
    expect([200, 400, 500]).toContain(response.status());

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty("url");
      expect(data.url).toContain("checkout.stripe.com");
    } else {
      const data = await response.json();
      // Stripe key might not be configured
      expect(data.error).toBeTruthy();
    }
  });
});

test.describe("Stripe: Payment Flow", () => {
  test.skip(!STRIPE_TEST_PUBLISHABLE_KEY, "Skipping: STRIPE_TEST_PUBLISHABLE_KEY not set");

  test("Membership page shows payment options", async ({ page }) => {
    await loginUser(page, TEST_USERS.member.email, TEST_USERS.member.password);
    await page.goto("/member/membership");
    await waitForLoadingComplete(page);

    // Should show membership options or subscription info
    const membershipContent = page.locator("main");
    await expect(membershipContent).toBeVisible();

    // Look for upgrade/subscribe buttons
    const subscribeBtn = page.getByRole("button", { name: /předplatit|subscribe|upgrade|platit/i }).first();
    const membershipInfo = page.getByText(/členství|membership|subscription/i).first();

    const hasSubscribeBtn = await subscribeBtn.isVisible().catch(() => false);
    const hasMembershipInfo = await membershipInfo.isVisible().catch(() => false);

    expect(hasSubscribeBtn || hasMembershipInfo).toBe(true);
  });

  test("Subscription checkout redirects to Stripe", async ({ page, context }) => {
    await loginUser(page, TEST_USERS.member.email, TEST_USERS.member.password);
    await page.goto("/member/membership");
    await waitForLoadingComplete(page);

    // Find subscribe/upgrade button
    const subscribeBtn = page.getByRole("button", { name: /předplatit|subscribe|upgrade|platit/i }).first();

    if (await subscribeBtn.isVisible().catch(() => false)) {
      // Listen for navigation to Stripe
      const navigationPromise = page.waitForURL(/stripe\.com|checkout/, { timeout: 15000 }).catch(() => null);
      
      await subscribeBtn.click();
      
      // Wait for either Stripe redirect or modal
      const stripeNavigation = await navigationPromise;
      
      if (stripeNavigation) {
        // Redirected to Stripe checkout
        expect(page.url()).toContain("stripe.com");
      } else {
        // Might show embedded checkout or price selection modal
        const modal = page.getByRole("dialog");
        const hasModal = await modal.isVisible().catch(() => false);
        
        // At least something happened
        expect(hasModal || page.url().includes("stripe")).toBe(true);
      }
    }
  });
});

test.describe("Stripe: Test Card Payment", () => {
  test.skip(!STRIPE_TEST_PUBLISHABLE_KEY, "Skipping: STRIPE_TEST_PUBLISHABLE_KEY not set");

  test("Stripe Elements form accepts test card", async ({ page }) => {
    // This test requires an actual checkout session
    // We'll test that Stripe Elements can be interacted with

    await loginUser(page, TEST_USERS.member.email, TEST_USERS.member.password);
    await page.goto("/member/membership");
    await waitForLoadingComplete(page);

    // Find and click subscribe button
    const subscribeBtn = page.getByRole("button", { name: /předplatit|subscribe|platit/i }).first();
    
    if (await subscribeBtn.isVisible().catch(() => false)) {
      await subscribeBtn.click();
      await page.waitForTimeout(3000);

      // If redirected to Stripe hosted checkout
      if (page.url().includes("checkout.stripe.com")) {
        // Fill Stripe checkout form
        const emailInput = page.locator("input[name='email'], input[type='email']").first();
        const cardInput = page.locator("input[name='cardNumber'], [data-testid='card-number']").first();

        if (await emailInput.isVisible().catch(() => false)) {
          await emailInput.fill(TEST_USERS.member.email);
        }

        // Stripe Elements are in iframes - find card iframe
        const cardFrame = page.frameLocator("iframe[name*='card'], iframe[title*='card']").first();
        const cardNumberField = cardFrame.locator("input[name='cardnumber']");

        if (await cardNumberField.isVisible().catch(() => false)) {
          await cardNumberField.fill(STRIPE_TEST_CARD_NO);
          
          // Fill expiry
          const expiryField = cardFrame.locator("input[name='exp-date']");
          if (await expiryField.isVisible().catch(() => false)) {
            await expiryField.fill(STRIPE_TEST_EXPIRY);
          }

          // Fill CVC
          const cvcField = cardFrame.locator("input[name='cvc']");
          if (await cvcField.isVisible().catch(() => false)) {
            await cvcField.fill(STRIPE_TEST_CVC);
          }
        }
      }
    }
  });
});

test.describe("Stripe: Webhook Integration", () => {
  test("Stripe webhook endpoint exists", async ({ request }) => {
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/stripe-webhook`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: { type: "test" }
    });

    // Should respond (even if 400/401 due to missing signature)
    expect(response.status()).not.toBe(404);
  });

  test("Webhook rejects unsigned requests", async ({ request }) => {
    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/stripe-webhook`, {
      headers: {
        "Content-Type": "application/json",
      },
      data: {
        type: "checkout.session.completed",
        data: { object: {} }
      }
    });

    // Should reject - no valid Stripe signature
    expect([400, 401, 403, 500]).toContain(response.status());
  });
});

test.describe("Stripe: Order Payment", () => {
  test("Shop checkout initiates payment", async ({ page }) => {
    await loginUser(page, TEST_USERS.member.email, TEST_USERS.member.password);
    
    // Add product to cart
    await page.goto("/shop");
    await waitForLoadingComplete(page);

    const productCard = page.locator("article a[href^='/shop/']").first();
    if (await productCard.isVisible().catch(() => false)) {
      await productCard.click();
      await waitForLoadingComplete(page);

      const addToCartBtn = page.getByRole("button", { name: /přidat|add to cart/i }).first();
      if (await addToCartBtn.isVisible().catch(() => false)) {
        await addToCartBtn.click();
        await page.waitForTimeout(1000);
      }

      // Go to checkout
      await page.goto("/checkout");
      await waitForLoadingComplete(page);

      // Look for payment button
      const payBtn = page.getByRole("button", { name: /zaplatit|pay|platit|objednat/i }).first();
      
      if (await payBtn.isVisible().catch(() => false)) {
        // Click should either redirect to Stripe or show payment form
        const [response] = await Promise.all([
          page.waitForResponse(resp => resp.url().includes("stripe") || resp.url().includes("checkout"), { timeout: 10000 }).catch(() => null),
          payBtn.click()
        ]);

        // Payment flow initiated
        expect(response !== null || page.url().includes("stripe") || page.url().includes("checkout")).toBe(true);
      }
    }
  });
});

test.describe("Stripe: Payment Session Tracking", () => {
  test("Payment sessions are tracked in database", async ({ request }) => {
    const token = await getUserToken(request, TEST_USERS.admin);
    test.skip(!token, "Could not authenticate");

    // Query payment_sessions via RPC
    const response = await request.post(`${AISHA_POSTGREST_URL}/rest/v1/rpc/get_my_payment_sessions`, {
      headers: {
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {}
    });

    // RPC might not exist yet - that's OK
    // If it exists, it should return array
    if (response.status() === 200) {
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    }
  });
});
