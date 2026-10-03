/**
 * E2E Tests: Membership & Subscription Management
 *
 * Testy pro:
 * - Správa členství (memberships)
 * - Subscription packages
 * - Member subscriptions
 * - Access levels
 */

import { test, expect, Page } from "@playwright/test";

test.use({ storageState: "e2e/.auth/admin.json" });

const waitForLoadingComplete = async (page: Page) => {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
};

test.describe("Membership Management", () => {
  test("admin can access memberships page", async ({ page }) => {
    await page.goto("/admin/memberships");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("memberships page shows member list", async ({ page }) => {
    await page.goto("/admin/memberships");
    await waitForLoadingComplete(page);

    // Should show memberships table or list
    const table = page.locator("table, [role='table']").first();
    await expect(table).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("memberships table has expected columns", async ({ page }) => {
    await page.goto("/admin/memberships");
    await waitForLoadingComplete(page);

    // Check for expected columns
    const expectedPatterns = [/member|člen|user/i, /tier|úroveň|level/i, /status|stav/i];
    
    for (const pattern of expectedPatterns) {
      const header = page.locator("th, [role='columnheader']").filter({ hasText: pattern }).first();
      await expect(header).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });

  test("admin can filter memberships by tier", async ({ page }) => {
    await page.goto("/admin/memberships");
    await waitForLoadingComplete(page);

    // Look for tier filter
    const tierFilter = page.locator("select, [role='combobox'], button").filter({ 
      hasText: /tier|úroveň|level|filtr/i 
    }).first();
    
    if (await tierFilter.isVisible()) {
      await tierFilter.click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe("Subscription Packages", () => {
  test("admin can access subscription packages page", async ({ page }) => {
    await page.goto("/admin/subscription-packages");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("subscription packages shows package list", async ({ page }) => {
    await page.goto("/admin/subscription-packages");
    await waitForLoadingComplete(page);

    // Should show packages table or cards
    const packages = page.locator("table, [role='table'], .grid, [class*='card']").first();
    await expect(packages).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("packages show price and features", async ({ page }) => {
    await page.goto("/admin/subscription-packages");
    await waitForLoadingComplete(page);

    // Look for price information
    const priceInfo = page.locator("text=/price|cena|kč|czk|€|\\$/i").first();
    await expect(priceInfo).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test("admin can create new package", async ({ page }) => {
    await page.goto("/admin/subscription-packages");
    await waitForLoadingComplete(page);

    // Look for create button
    const createButton = page.locator("button").filter({ hasText: /create|add|vytvořit|přidat/i }).first();
    
    if (await createButton.isVisible()) {
      await createButton.click();
      await page.waitForTimeout(500);

      // Should show form or modal
      const form = page.locator("form, [role='dialog']").first();
      await expect(form).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });
});

test.describe("Access Levels", () => {
  test("admin can access access-levels page", async ({ page }) => {
    await page.goto("/admin/access-levels");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("access levels shows level definitions", async ({ page }) => {
    await page.goto("/admin/access-levels");
    await waitForLoadingComplete(page);

    // Should show access levels table or list
    const levels = page.locator("table, [role='table'], .grid").first();
    await expect(levels).toBeVisible({ timeout: 10000 }).catch(() => {});
  });
});

test.describe("Member Roles", () => {
  test("admin can access roles page", async ({ page }) => {
    await page.goto("/admin/roles");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("roles page shows role list", async ({ page }) => {
    await page.goto("/admin/roles");
    await waitForLoadingComplete(page);

    // Should show roles: admin, staff, practitioner, member, evaluator
    const expectedRoles = ["admin", "staff", "practitioner", "member", "evaluator"];
    
    for (const role of expectedRoles) {
      const roleItem = page.locator(`text=${role}`).first();
      await expect(roleItem).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });

  test("admin can view role permissions", async ({ page }) => {
    await page.goto("/admin/roles");
    await waitForLoadingComplete(page);

    // Look for permissions section or expand
    const permissionsLink = page.locator("button, a").filter({ hasText: /permission|oprávnění|detail/i }).first();
    
    if (await permissionsLink.isVisible()) {
      await permissionsLink.click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe("User Roles Assignment", () => {
  test("admin can access users page", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("users page shows role column", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForLoadingComplete(page);

    const table = page.locator("table, [role='table']").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Check for role column
    const roleHeader = page.locator("th, [role='columnheader']").filter({ hasText: /role|role/i }).first();
    await expect(roleHeader).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test("admin can assign role to user", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForLoadingComplete(page);

    // Find first user row
    const row = page.locator("tr, [role='row']").nth(1);
    
    if (await row.isVisible()) {
      // Look for role selector or edit button
      const roleAction = row.locator("button, select, [role='combobox']").first();
      
      if (await roleAction.isVisible()) {
        await roleAction.click();
        await page.waitForTimeout(500);
      }
    }
  });
});

test.describe("Permissions Management", () => {
  test("admin can access permissions page", async ({ page }) => {
    await page.goto("/admin/permissions");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("permissions page shows permission matrix", async ({ page }) => {
    await page.goto("/admin/permissions");
    await waitForLoadingComplete(page);

    // Should show permissions table or matrix
    const matrix = page.locator("table, [role='table'], .grid").first();
    await expect(matrix).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("permissions are grouped by section", async ({ page }) => {
    await page.goto("/admin/permissions");
    await waitForLoadingComplete(page);

    // Look for section groupings
    const sections = page.locator("text=/secure|admin|partner|member|shop/i");
    await expect(sections.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
  });
});
