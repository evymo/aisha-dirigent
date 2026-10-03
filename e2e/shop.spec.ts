/**
 * E2E Tests: Shop & Cart Flow
 *
 * Testuje e-shop funkcionalitu a základní checkout flow.
 */

import { test, expect, waitForLoadingComplete } from "./fixtures";

test.describe("Shop: Product Listing", () => {
  test("products page loads", async ({ page }) => {
    await page.goto("/shop");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("products or empty state is visible", async ({ page }) => {
    await page.goto("/shop");
    await waitForLoadingComplete(page);

    const products = page.locator("article a[href^='/shop/']").first();
    const emptyState = page.getByText(/žádné produkty|no products|prázdné/i);

    const hasProducts = await products.isVisible().catch(() => false);
    const isEmpty = await emptyState.isVisible().catch(() => false);

    expect(hasProducts || isEmpty).toBe(true);
  });

  test("product detail navigation works", async ({ page }) => {
    await page.goto("/shop");
    await waitForLoadingComplete(page);

    const productLink = page.locator("article a[href^='/shop/']").first();
    if (await productLink.isVisible().catch(() => false)) {
      await productLink.click();
      await waitForLoadingComplete(page);

      await expect(page).toHaveURL(/\/shop\/.+/);
    }
  });
});

test.describe("Shop: Product Detail", () => {
  test("product detail shows purchase CTA", async ({ page }) => {
    await page.goto("/shop");
    await waitForLoadingComplete(page);

    const productLink = page.locator("article a[href^='/shop/']").first();
    if (await productLink.isVisible().catch(() => false)) {
      await productLink.click();
      await waitForLoadingComplete(page);

      const addToCart = page.getByRole("button", { name: /přidat|add to cart|košík/i }).first();
      const checkoutLink = page.locator("a[href='/checkout']").first();

      await expect
        .poll(
          async () =>
            (await addToCart.isVisible().catch(() => false)) ||
            (await checkoutLink.isVisible().catch(() => false)),
          { timeout: 15000 }
        )
        .toBe(true);
    }
  });
});

test.describe("Shop: Cart Sheet", () => {
  test("cart sheet opens", async ({ page }) => {
    await page.goto("/shop");
    await waitForLoadingComplete(page);

    const cartButton = page.getByRole("button", { name: /open cart/i }).first();
    if (await cartButton.isVisible().catch(() => false)) {
      await cartButton.click();
      await expect(page.getByRole("dialog")).toBeVisible();
    }
  });
});

test.describe("Shop: Checkout", () => {
  test("checkout route is accessible or redirected", async ({ page }) => {
    await page.goto("/checkout");
    await waitForLoadingComplete(page);

    const currentUrl = page.url();
    const isCheckout = currentUrl.includes("/checkout");
    const isAuth = currentUrl.includes("/auth");
    const isHome = currentUrl.endsWith("/");

    expect(isCheckout || isAuth || isHome).toBe(true);

    if (isCheckout) {
      const content = page.locator("main, [role='main']").first();
      await expect(content).toBeVisible();
    }
  });
});
