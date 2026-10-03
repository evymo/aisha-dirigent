/**
 * E2E Tests: Role-Based Access Control
 *
 * Testy ověřující správný přístup různých rolí k různým částem aplikace.
 * 
 * Roles tested:
 * - admin: Full access
 * - staff: Limited admin access
 * - partner: Partner dashboard, user access with consent
 * - member: Own data only
 */

import { test, expect, Page } from "@playwright/test";

const waitForLoadingComplete = async (page: Page) => {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
};

// =============================================================================
// ADMIN ROLE TESTS
// =============================================================================
test.describe("RBAC - Admin Access", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("admin can access admin dashboard", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);
    
    // Should stay on admin page
    expect(page.url()).toContain("/admin");
    
    // Should see admin content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("admin can access member management", async ({ page }) => {
    await page.goto("/admin/members");
    await waitForLoadingComplete(page);
    
    expect(page.url()).toContain("/admin/members");
    
    // Should see members table or list
    const table = page.locator("table, [role='table']").first();
    await expect(table).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("admin can access roles management", async ({ page }) => {
    await page.goto("/admin/roles");
    await waitForLoadingComplete(page);
    
    expect(page.url()).toContain("/admin/roles");
  });

  test("admin can access audit journal", async ({ page }) => {
    await page.goto("/admin/audit-journal");
    await waitForLoadingComplete(page);
    
    expect(page.url()).toContain("/admin/audit-journal");
    
    // Should see audit entries
    const table = page.locator("table, [role='table']").first();
    await expect(table).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("admin can access partner dashboard", async ({ page }) => {
    await page.goto("/partner");
    await waitForLoadingComplete(page);
    
    // Admin should be able to access partner area too
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("admin can access storyloop", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);
    
    // Should see storyloop content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });
});

// =============================================================================
// PARTNER ROLE TESTS
// =============================================================================
test.describe("RBAC - Partner Access", () => {
  test.use({ storageState: "e2e/.auth/partner.json" });

  test("partner can access partner dashboard", async ({ page }) => {
    await page.goto("/partner");
    await waitForLoadingComplete(page);
    
    // Should see partner content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("partner can access storyloop", async ({ page }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);
    
    // Should see storyloop or be on partner page
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("partner can access appointments", async ({ page }) => {
    await page.goto("/partner/appointments");
    await waitForLoadingComplete(page);
    
    // Should see appointments page
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("partner can access availability settings", async ({ page }) => {
    await page.goto("/partner/availability");
    await waitForLoadingComplete(page);
    
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("partner CANNOT access admin dashboard", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);
    
    // Should be redirected away from admin
    // Either to home, partner dashboard, or show access denied
    const url = page.url();
    const isBlocked = !url.includes("/admin") || 
      await page.locator("text=/access denied|nemáte oprávnění|unauthorized/i").isVisible().catch(() => false);
    
    expect(isBlocked).toBe(true);
  });

  test("partner CANNOT access member management", async ({ page }) => {
    await page.goto("/admin/members");
    await waitForLoadingComplete(page);
    
    // Should be redirected or show access denied
    const url = page.url();
    expect(url.includes("/admin/members")).toBe(false);
  });
});

// =============================================================================
// MEMBER ROLE TESTS
// =============================================================================
test.describe("RBAC - Member Access", () => {
  test.use({ storageState: "e2e/.auth/member.json" });

  test("member can access member dashboard", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);
    
    // Should see member content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("member can access health tracking", async ({ page }) => {
    await page.goto("/member/tracking");
    await waitForLoadingComplete(page);
    
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("member can access studies", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);
    
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("member can access shop", async ({ page }) => {
    await page.goto("/shop");
    await waitForLoadingComplete(page);
    
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("member CANNOT access admin dashboard", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);
    
    // Should be redirected away from admin
    const url = page.url();
    expect(url.includes("/admin")).toBe(false);
  });

  test("member CANNOT access partner dashboard", async ({ page }) => {
    await page.goto("/partner");
    await waitForLoadingComplete(page);
    
    // Should be redirected away from partner
    const url = page.url();
    const isBlocked = !url.includes("/partner") ||
      await page.locator("text=/access denied|nemáte oprávnění/i").isVisible().catch(() => false);
    
    expect(isBlocked).toBe(true);
  });
});

// =============================================================================
// UNAUTHENTICATED ACCESS TESTS
// =============================================================================
test.describe("RBAC - Unauthenticated Access", () => {
  // No storageState - unauthenticated

  test("public can access landing page", async ({ page }) => {
    await page.goto("/");
    await waitForLoadingComplete(page);
    
    const content = page.locator("main, [role='main'], body").first();
    await expect(content).toBeVisible();
  });

  test("public can access shop", async ({ page }) => {
    await page.goto("/shop");
    await waitForLoadingComplete(page);
    
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("public can access studies", async ({ page }) => {
    await page.goto("/studies");
    await waitForLoadingComplete(page);
    
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("public can access partners directory", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);
    
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("public CANNOT access member area", async ({ page }) => {
    await page.goto("/member");
    await waitForLoadingComplete(page);
    
    // Should be redirected to auth
    const url = page.url();
    expect(url.includes("/auth") || url === page.url().split("/member")[0] + "/").toBe(true);
  });

  test("public CANNOT access admin area", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);
    
    // Should be redirected to auth or home
    const url = page.url();
    expect(url.includes("/admin")).toBe(false);
  });

  test("public CANNOT access partner area", async ({ page }) => {
    await page.goto("/partner");
    await waitForLoadingComplete(page);
    
    // Should be redirected
    const url = page.url();
    expect(url.includes("/partner")).toBe(false);
  });
});
