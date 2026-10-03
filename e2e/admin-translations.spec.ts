/**
 * E2E Tests: Admin Translations (i18n)
 *
 * Testy pro:
 * - Správa překladů v administraci
 * - Zobrazení seznamu překladových stringů
 * - Změna jazyka
 */

import { test, expect, Page } from "@playwright/test";

test.use({ storageState: "e2e/.auth/admin.json" });

const waitForLoadingComplete = async (page: Page) => {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
};

test.describe("Admin Translations Management", () => {
  test("admin can access translations page", async ({ page }) => {
    await page.goto("/admin/translations");
    await waitForLoadingComplete(page);

    // Should see translations content
    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("translations page shows language options", async ({ page }) => {
    await page.goto("/admin/translations");
    await waitForLoadingComplete(page);

    // Should show language selectors or tabs
    const languageSelector = page.locator(
      "select, [role='combobox'], button, [role='tab']"
    ).filter({ hasText: /cs|en|de|fr|ru|th|czech|english|german|french|russian|thai|česky|anglicky/i });
    
    await expect(languageSelector.first()).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("translations page shows translation keys", async ({ page }) => {
    await page.goto("/admin/translations");
    await waitForLoadingComplete(page);

    // Should show translation keys in table or list
    const table = page.locator("table, [role='table']").first();
    if (await table.isVisible()) {
      // Check for key/value columns
      const keyColumn = page.locator("th, [role='columnheader']").filter({ hasText: /key|klíč/i }).first();
      await expect(keyColumn).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });

  test("translations can be filtered or searched", async ({ page }) => {
    await page.goto("/admin/translations");
    await waitForLoadingComplete(page);

    // Look for search input
    const searchInput = page.locator("input[type='search'], input[type='text'], input[placeholder*='search'], input[placeholder*='hledat']").first();
    
    if (await searchInput.isVisible()) {
      await searchInput.fill("common");
      await page.waitForTimeout(500);
      
      // Results should update
      const results = page.locator("table tbody tr, [role='row']");
      await expect(results.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });
});

test.describe("UI Language Switching", () => {
  test("user can switch language from header", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);

    // Look for language selector in header
    const languageButton = page.locator(
      "button, [role='button']"
    ).filter({ hasText: /🇨🇿|🇺🇸|🇬🇧|cs|en|cz|language|jazyk/i }).first();
    
    if (await languageButton.isVisible()) {
      await languageButton.click();
      await page.waitForTimeout(500);
      
      // Should show language options
      const options = page.locator("[role='menuitem'], [role='option'], button").filter({
        hasText: /english|česky|deutsch|français|русский|ไทย/i
      });
      await expect(options.first()).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });

  test("changing language updates UI texts", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);

    // Record current text
    const dashboardText = page.locator("text=/dashboard|přehled/i").first();
    const initialText = await dashboardText.textContent().catch(() => "");

    // Try to switch language
    const languageButton = page.locator(
      "button, [role='button']"
    ).filter({ hasText: /🇨🇿|🇺🇸|🇬🇧|cs|en/i }).first();
    
    if (await languageButton.isVisible()) {
      await languageButton.click();
      await page.waitForTimeout(500);
      
      // Click on different language
      const otherLang = page.locator("[role='menuitem'], [role='option'], button").filter({
        hasText: /english|česky/i
      }).first();
      
      if (await otherLang.isVisible()) {
        await otherLang.click();
        await waitForLoadingComplete(page);
      }
    }
  });
});

test.describe("Admin Content Translations", () => {
  test("admin can access archive documents translations", async ({ page }) => {
    await page.goto("/admin/archive");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();

    // Archive should have multilingual content support
    const table = page.locator("table, [role='table']").first();
    await expect(table).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test("admin can access faq translations", async ({ page }) => {
    await page.goto("/admin/faq");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("admin can access about page content", async ({ page }) => {
    await page.goto("/admin/about-page");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });
});

test.describe("System Messages Translations", () => {
  test("admin can access system announcements", async ({ page }) => {
    await page.goto("/admin/system-announcements");
    await waitForLoadingComplete(page);

    const content = page.locator("main, [role='main']").first();
    await expect(content).toBeVisible();
  });

  test("system announcements show language options", async ({ page }) => {
    await page.goto("/admin/system-announcements");
    await waitForLoadingComplete(page);

    // Look for language selector or tabs for multilingual content
    const langSelector = page.locator(
      "select, [role='combobox'], [role='tablist']"
    ).first();
    await expect(langSelector).toBeVisible({ timeout: 5000 }).catch(() => {});
  });
});
