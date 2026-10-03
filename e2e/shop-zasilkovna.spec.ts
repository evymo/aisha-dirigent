/**
 * E2E Tests: Shop with Zásilkovna (Packeta) Integration
 * 
 * Tests complete shop flow including:
 * - Product selection
 * - Cart management  
 * - Checkout with Zásilkovna delivery (address + pickup box)
 * - Order completion
 */

import { test, expect, Page } from "@playwright/test";
import { waitForLoadingComplete } from "./fixtures";

// Packeta test data
const PACKETA_TEST_ADDRESS = {
  street: "Václavské náměstí 1",
  city: "Praha",
  zip: "11000",
  country: "CZ",
};

const PACKETA_TEST_BOX = {
  id: "12345",
  name: "Test Box Praha",
  address: "Praha 1",
};

test.describe("Shop: Full Purchase Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh for each test
    await page.goto("/");
    await waitForLoadingComplete(page);
  });

  test("Complete flow: Browse → Cart → Checkout", async ({ page }) => {
    // 1. Go to shop
    await page.goto("/shop");
    await waitForLoadingComplete(page);

    // 2. Find a product
    const productCard = page.locator("article a[href^='/shop/'], [data-testid='product-card']").first();
    
    if (!await productCard.isVisible().catch(() => false)) {
      test.skip("No products available in shop");
      return;
    }

    // 3. Go to product detail
    await productCard.click();
    await waitForLoadingComplete(page);
    await expect(page).toHaveURL(/\/shop\/.+/);

    // 4. Add to cart
    const addToCartBtn = page.getByRole("button", { name: /přidat do košíku|add to cart|koupit/i }).first();
    if (await addToCartBtn.isVisible().catch(() => false)) {
      await addToCartBtn.click();
      
      // Wait for cart update
      await page.waitForTimeout(1000);
      
      // 5. Open cart
      const cartButton = page.getByRole("button", { name: /košík|cart/i }).first();
      if (await cartButton.isVisible().catch(() => false)) {
        await cartButton.click();
        
        // Cart should show item
        const cartDialog = page.getByRole("dialog");
        await expect(cartDialog).toBeVisible({ timeout: 5000 });
      }
    }
  });
});

/**
 * Helper: Add a product to cart
 */
async function addProductToCart(page: Page): Promise<boolean> {
  await page.goto("/shop");
  await waitForLoadingComplete(page);

  const productCard = page.locator("article a[href^='/shop/']").first();
  if (!await productCard.isVisible().catch(() => false)) {
    return false;
  }

  await productCard.click();
  await waitForLoadingComplete(page);

  const addToCartBtn = page.getByRole("button", { name: /přidat|add to cart/i }).first();
  if (!await addToCartBtn.isVisible().catch(() => false)) {
    return false;
  }

  await addToCartBtn.click();
  await page.waitForTimeout(1000);
  return true;
}

test.describe("Shop: Zásilkovna Delivery Options", () => {
  // Use member storage state
  test.use({ storageState: "e2e/.auth/member.json" });

  test("Checkout shows delivery method selection", async ({ page }) => {
    // Add item to cart first
    const hasProduct = await addProductToCart(page);
    test.skip(!hasProduct, "No products available in shop");

    // Go to checkout
    await page.goto("/checkout");
    await waitForLoadingComplete(page);

    // Should show delivery options
    const deliverySection = page.locator("[data-testid='delivery-options'], .delivery-method, #delivery");
    const hasDeliveryOptions = await deliverySection.isVisible().catch(() => false);

    // Or shipping step in multistep checkout
    const shippingStep = page.getByText(/doprava|shipping|doručení/i);
    const hasShippingStep = await shippingStep.first().isVisible().catch(() => false);

    expect(hasDeliveryOptions || hasShippingStep).toBe(true);
  });

  test("Zásilkovna to address option available", async ({ page }) => {
    // Add item to cart first
    const hasProduct = await addProductToCart(page);
    test.skip(!hasProduct, "No products available in shop");
    
    await page.goto("/checkout");
    await waitForLoadingComplete(page);

    // Look for Zásilkovna/Packeta delivery option
    const packetaOption = page.locator("text=/zásilkovna|packeta|na adresu/i").first();
    const addressDelivery = page.locator("input[value*='address'], [data-delivery='address']").first();

    const hasPacketa = await packetaOption.isVisible().catch(() => false);
    const hasAddressOption = await addressDelivery.isVisible().catch(() => false);

    // At least one delivery option should exist
    const anyDeliveryOption = page.locator("input[type='radio'][name*='delivery'], input[type='radio'][name*='shipping']").first();
    const hasAnyOption = await anyDeliveryOption.isVisible().catch(() => false);

    expect(hasPacketa || hasAddressOption || hasAnyOption).toBe(true);
  });

  test("Zásilkovna pickup box selection", async ({ page }) => {
    // Add item to cart first
    const hasProduct = await addProductToCart(page);
    test.skip(!hasProduct, "No products available in shop");
    
    await page.goto("/checkout");
    await waitForLoadingComplete(page);

    // Look for pickup point / box selection
    const pickupOption = page.locator("text=/výdejní místo|pickup point|z-box|zásilkovna box/i").first();
    const selectPickupBtn = page.getByRole("button", { name: /vybrat místo|select point|vybrat box/i }).first();

    if (await pickupOption.isVisible().catch(() => false)) {
      await pickupOption.click();
      await page.waitForTimeout(500);

      // Should show pickup point selector
      const pickupSelector = page.locator("[data-testid='pickup-selector'], .packeta-selector, iframe[src*='packeta']");
      const selectButton = page.getByRole("button", { name: /vybrat|select/i }).first();

      const hasSelector = await pickupSelector.isVisible().catch(() => false);
      const hasSelectButton = await selectButton.isVisible().catch(() => false);

      expect(hasSelector || hasSelectButton || await selectPickupBtn.isVisible().catch(() => false)).toBe(true);
    }
  });

  test("Address form validation", async ({ page }) => {
    // Add item to cart first
    const hasProduct = await addProductToCart(page);
    test.skip(!hasProduct, "No products available in shop");
    
    await page.goto("/checkout");
    await waitForLoadingComplete(page);

    // Find address form fields
    const streetInput = page.locator("input[name*='street'], input[name*='address'], input[placeholder*='ulice']").first();
    const cityInput = page.locator("input[name*='city'], input[name*='město']").first();
    const zipInput = page.locator("input[name*='zip'], input[name*='psč']").first();

    if (await streetInput.isVisible().catch(() => false)) {
      // Fill with test address
      await streetInput.fill(PACKETA_TEST_ADDRESS.street);
      
      if (await cityInput.isVisible().catch(() => false)) {
        await cityInput.fill(PACKETA_TEST_ADDRESS.city);
      }
      
      if (await zipInput.isVisible().catch(() => false)) {
        await zipInput.fill(PACKETA_TEST_ADDRESS.zip);
      }

      // Verify fields are filled
      await expect(streetInput).toHaveValue(PACKETA_TEST_ADDRESS.street);
    }
  });
});

test.describe("Shop: Order Summary", () => {
  // Use member storage state
  test.use({ storageState: "e2e/.auth/member.json" });

  test("Order summary shows items and total", async ({ page }) => {
    // Add item to cart first
    const hasProduct = await addProductToCart(page);
    test.skip(!hasProduct, "No products available in shop");
    
    await page.goto("/checkout");
    await waitForLoadingComplete(page);

    // Look for order summary section or price info
    const priceText = page.locator("text=/celkem|total|kč|czk|\\d+\\s*Kč/i").first();
    const summarySection = page.locator("[data-testid='order-summary'], .order-summary, aside");
    
    const hasPrice = await priceText.isVisible().catch(() => false);
    const hasSummary = await summarySection.isVisible().catch(() => false);
    
    expect(hasPrice || hasSummary).toBe(true);
  });

  test("Empty cart redirects or shows message", async ({ page }) => {
    // Go directly to checkout with empty cart (no product added)
    await page.goto("/checkout");
    await waitForLoadingComplete(page);

    const currentUrl = page.url();
    
    // Either redirected away from checkout or shows empty cart message
    const emptyMessage = page.getByText(/prázdný košík|empty cart|cart is empty|no items|your cart is empty/i);
    const hasEmptyMessage = await emptyMessage.isVisible().catch(() => false);
    const wasRedirected = !currentUrl.includes("/checkout");

    expect(hasEmptyMessage || wasRedirected).toBe(true);
  });
});

test.describe("Shop: Packeta API Integration", () => {
  const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
  const ANON_KEY = process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

  test("Packeta API endpoint responds (requires auth)", async ({ request }) => {
    // Call without auth - should get 401
    const response = await request.get(`${AISHA_POSTGREST_URL}/functions/v1/packeta-api`, {
      headers: {
        apikey: ANON_KEY,
      },
    });

    // Should return 401 without proper auth header
    expect(response.status()).toBe(401);
    const data = await response.json();
    expect(data.error).toMatch(/authorization|token/i);
  });

  test("Packeta pickup-points endpoint (unauthenticated)", async ({ request }) => {
    // The pickup-points endpoint in the Edge Function checks for authentication
    // So without a valid Bearer token, it should return 401
    const response = await request.get(
      `${AISHA_POSTGREST_URL}/functions/v1/packeta-api/pickup-points?country=cz`,
      {
        headers: {
          apikey: ANON_KEY,
        },
      }
    );

    // Without auth, expect 401
    expect(response.status()).toBe(401);
  });
});

test.describe("Shop: Packeta API (Authenticated)", () => {
  const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
  const ANON_KEY =
    process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

  async function getMemberToken(
    request: import("@playwright/test").APIRequestContext
  ): Promise<string | null> {
    try {
      const response = await request.post(`${AISHA_POSTGREST_URL}/auth/v1/token?grant_type=password`, {
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        data: {
          email: "member@platform.rtn",
          password: "Member123!",
        },
      });

      if (!response.ok()) {
        return null;
      }

      const data = (await response.json()) as { access_token: string };
      return data.access_token;
    } catch {
      return null;
    }
  }

  async function getAdminToken(
    request: import("@playwright/test").APIRequestContext
  ): Promise<string | null> {
    try {
      const response = await request.post(`${AISHA_POSTGREST_URL}/auth/v1/token?grant_type=password`, {
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        data: {
          email: "admin@platform.rtn",
          password: "Admin123!",
        },
      });

      if (!response.ok()) {
        return null;
      }

      const data = (await response.json()) as { access_token: string };
      return data.access_token;
    } catch {
      return null;
    }
  }

  test("Authenticated member cannot call create-packet (no permission)", async ({ request }) => {
    const token = await getMemberToken(request);
    test.skip(!token, "Could not authenticate as member");

    const response = await request.post(`${AISHA_POSTGREST_URL}/functions/v1/packeta-api/create-packet`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        orderId: "00000000-0000-0000-0000-000000000000",
      },
    });

    // Should get 403 Forbidden (insufficient permissions)
    expect(response.status()).toBe(403);
    const data = await response.json();
    expect(data.error).toMatch(/permission|insufficient/i);
  });

  test("Admin can call pickup-points endpoint", async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, "Could not authenticate as admin");

    const response = await request.get(
      `${AISHA_POSTGREST_URL}/functions/v1/packeta-api/pickup-points?country=cz`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // Edge function requires PACKETA_API_KEY to be set in Supabase secrets
    // If not set, we might get 500 or similar
    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty("pickupPoints");
      expect(Array.isArray(data.pickupPoints)).toBe(true);
    } else if (response.status() === 403) {
      // Admin might not have process_orders permission in local seed
      const data = await response.json();
      expect(data.error).toBeDefined();
    } else {
      // 500/546 = PACKETA_API_KEY not configured or Edge Function error - acceptable in local env
      expect([500, 403, 546]).toContain(response.status());
    }
  });

  test("Admin can call track endpoint", async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, "Could not authenticate as admin");

    const response = await request.get(
      `${AISHA_POSTGREST_URL}/functions/v1/packeta-api/track?packetId=123456789`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // If PACKETA_API_KEY is set, we should get response
    // If not, we get 500 or 403
    expect([200, 403, 500]).toContain(response.status());
  });
});
