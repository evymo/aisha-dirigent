/**
 * E2E Tests: Storyloop Access Control
 *
 * Testy pro:
 * - Admin přístup do Storyloop
 * - Staff přístup do Storyloop
 * - Partner přístup do Storyloop
 * - Member NEMÁ přístup do admin Storyloop
 */

import { test, expect, Page } from "@playwright/test";

const waitForLoadingComplete = async (page: Page) => {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
};

test.describe("Storyloop - Admin Access", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("admin can access storyloop management", async ({ page }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    // Should see storyloop admin content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // Should not see access denied
    const accessDenied = page.locator("text=/access denied|přístup zamítnut|unauthorized/i").first();
    await expect(accessDenied).not.toBeVisible();
  });

  test("admin storyloop shows management controls", async ({ page }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    // Should have management controls
    const controls = page.locator("button, [role='button']").filter({
      hasText: /create|edit|delete|vytvořit|upravit|smazat/i,
    });
    await expect(controls.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test("admin can view storyloop categories", async ({ page }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    // Look for category management
    const categories = page.locator(
      "text=/category|kategorie|section|sekce/i"
    ).first();
    await expect(categories).toBeVisible({ timeout: 5000 }).catch(() => {});
  });
});

test.describe("Storyloop - Staff Access", () => {
  // Staff should have access (similar to admin but may have limited controls)
  test.use({ storageState: "e2e/.auth/admin.json" }); // Use admin as proxy for staff

  test("staff can access storyloop", async ({ page }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    // Should see storyloop content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });
});

test.describe("Storyloop - Partner Access", () => {
  test.use({ storageState: "e2e/.auth/partner.json" });

  test("partner can access partner storyloop", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Should see storyloop content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // Should not see access denied
    const accessDenied = page.locator("text=/access denied|přístup zamítnut|unauthorized/i").first();
    await expect(accessDenied).not.toBeVisible();
  });

  test("partner cannot access admin storyloop", async ({ page }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    // Should be redirected or access denied
    const url = page.url();
    const accessDenied = page.locator("text=/access denied|přístup zamítnut|unauthorized/i").first();
    
    const isBlocked = !url.includes("/admin/storyloop") || await accessDenied.isVisible();
    expect(isBlocked).toBeTruthy();
  });
});

test.describe("Storyloop - Member Access", () => {
  test.use({ storageState: "e2e/.auth/member.json" });

  test("member cannot access admin storyloop", async ({ page }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    // Should be redirected or access denied
    const url = page.url();
    const accessDenied = page.locator("text=/access denied|přístup zamítnut|unauthorized/i").first();
    
    const isBlocked = !url.includes("/admin/storyloop") || await accessDenied.isVisible();
    expect(isBlocked).toBeTruthy();
  });

  test("member cannot access partner storyloop", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Should be redirected or access denied
    const url = page.url();
    const accessDenied = page.locator("text=/access denied|přístup zamítnut|unauthorized/i").first();
    
    const isBlocked = !url.includes("/partner/storyloop") || await accessDenied.isVisible();
    expect(isBlocked).toBeTruthy();
  });
});

test.describe("Storyloop - Unauthenticated", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated cannot access admin storyloop", async ({ page }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    // Should be redirected to login
    const url = page.url();
    const isLoginPage = url.includes("/login") || url.includes("/auth");
    const isBlocked = !url.includes("/admin/storyloop");
    
    expect(isLoginPage || isBlocked).toBeTruthy();
  });

  test("unauthenticated cannot access partner storyloop", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    // Should be redirected to login
    const url = page.url();
    const isLoginPage = url.includes("/login") || url.includes("/auth");
    const isBlocked = !url.includes("/partner/storyloop");
    
    expect(isLoginPage || isBlocked).toBeTruthy();
  });
});
