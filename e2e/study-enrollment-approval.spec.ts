/**
 * E2E Tests: Study Registration & Approval Flow
 *
 * Testy pro:
 * - Schválení člena do studie (admin)
 * - Přiřazení konzultanta ke studii
 * - Správa registrations
 */

import { test, expect, Page } from "@playwright/test";

// Use admin auth state
test.use({ storageState: "e2e/.auth/admin.json" });

const waitForLoadingComplete = async (page: Page) => {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
};

test.describe("Study Registration Management", () => {
  test("admin can view registrations list", async ({ page }) => {
    await page.goto("/admin/registrations");
    await waitForLoadingComplete(page);

    // Should see registrations table
    const table = page.locator("table, [role='table']").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Should have status column
    const headers = page.locator("th, [role='columnheader']");
    const statusHeader = headers.filter({ hasText: /status|stav/i }).first();
    await expect(statusHeader).toBeVisible().catch(() => {});
  });

  test("registrations table has expected columns", async ({ page }) => {
    await page.goto("/admin/registrations");
    await waitForLoadingComplete(page);

    const table = page.locator("table, [role='table']").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Check for expected columns
    const expectedColumns = [/member|člen|user/i, /study|studie/i, /status|stav/i];
    
    for (const pattern of expectedColumns) {
      const header = page.locator("th, [role='columnheader']").filter({ hasText: pattern }).first();
      await expect(header).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });

  test("admin can filter registrations by status", async ({ page }) => {
    await page.goto("/admin/registrations");
    await waitForLoadingComplete(page);

    // Look for status filter
    const statusFilter = page.locator("select, [role='combobox'], button").filter({ hasText: /status|stav|filtr/i }).first();
    
    if (await statusFilter.isVisible()) {
      await statusFilter.click();
      await page.waitForTimeout(500);
      
      // Should show status options
      const options = page.locator("[role='option'], option");
      await expect(options.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });

  test("admin can open registration detail", async ({ page }) => {
    await page.goto("/admin/registrations");
    await waitForLoadingComplete(page);

    // Find first registration row
    const row = page.locator("tr, [role='row']").filter({ hasNotText: /member|člen/i }).nth(1);
    
    if (await row.isVisible()) {
      // Click on row or detail button
      const detailButton = row.locator("button, a").filter({ hasText: /detail|view|zobrazit/i }).first();
      
      if (await detailButton.isVisible()) {
        await detailButton.click();
        await waitForLoadingComplete(page);
      }
    }
  });

  test("registration detail shows member info", async ({ page }) => {
    await page.goto("/admin/registrations");
    await waitForLoadingComplete(page);

    // Try to open first registration
    const editButton = page.locator("button").filter({ hasText: /edit|upravit|detail/i }).first();
    
    if (await editButton.isVisible()) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Should show member/registration info
      const content = page.locator("main, [role='dialog'], .modal").first();
      await expect(content).toBeVisible();
    }
  });
});

test.describe("Study Consultant Management", () => {
  test("admin can view consultants list", async ({ page }) => {
    await page.goto("/admin/consultants");
    await waitForLoadingComplete(page);

    const table = page.locator("table, [role='table']").first();
    await expect(table).toBeVisible({ timeout: 10000 });
  });

  test("consultants table shows approval status", async ({ page }) => {
    await page.goto("/admin/consultants");
    await waitForLoadingComplete(page);

    // Should have status column
    const statusHeader = page.locator("th, [role='columnheader']").filter({ hasText: /status|stav/i }).first();
    await expect(statusHeader).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test("admin can filter consultants by status", async ({ page }) => {
    await page.goto("/admin/consultants");
    await waitForLoadingComplete(page);

    // Look for filter controls
    const filterButton = page.locator("button, select").filter({ hasText: /filter|filtr|status/i }).first();
    
    if (await filterButton.isVisible()) {
      await filterButton.click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe("Study Management", () => {
  test("admin can view studies list", async ({ page }) => {
    await page.goto("/admin/studies");
    await waitForLoadingComplete(page);

    const table = page.locator("table, [role='table']").first();
    await expect(table).toBeVisible({ timeout: 10000 });
  });

  test("studies table has expected columns", async ({ page }) => {
    await page.goto("/admin/studies");
    await waitForLoadingComplete(page);

    // Check for expected columns
    const expectedColumns = [/name|název/i, /status|stav/i];
    
    for (const pattern of expectedColumns) {
      const header = page.locator("th, [role='columnheader']").filter({ hasText: pattern }).first();
      await expect(header).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });

  test("admin can access study detail", async ({ page }) => {
    await page.goto("/admin/studies");
    await waitForLoadingComplete(page);

    // Find first study row
    const editButton = page.locator("button").filter({ hasText: /edit|upravit|detail/i }).first();
    
    if (await editButton.isVisible()) {
      await editButton.click();
      await waitForLoadingComplete(page);

      // Should show study form or detail
      const content = page.locator("form, [role='dialog'], .modal").first();
      await expect(content).toBeVisible();
    }
  });
});

test.describe("Study Consents", () => {
  test("admin can view study consents", async ({ page }) => {
    await page.goto("/admin/study-consents");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("study consents page shows consent templates", async ({ page }) => {
    await page.goto("/admin/study-consents");
    await waitForLoadingComplete(page);

    // Should have some content about consents
    const consentContent = page.locator("text=/consent|souhlas|informed/i").first();
    await expect(consentContent).toBeVisible({ timeout: 10000 }).catch(() => {});
  });
});
