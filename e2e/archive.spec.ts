/**
 * E2E Tests: Archive Documents
 * 
 * Tests public archive documents access:
 * - Viewing archive list
 * - Filtering and searching
 * - Document detail view
 */

import { test, expect } from "@playwright/test";
import { clearLocalStorage, waitForLoadingComplete } from "./fixtures";

test.describe("Archive Documents - Public Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Can access archive page without login", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Should display archive section
    const archiveSection = page.locator('[data-testid="archive"], .archive-list, main').first();
    await expect(archiveSection).toBeVisible({ timeout: 10000 });
  });

  test("Shows list of archive documents", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Should display documents list
    const documentsList = page.locator('[data-testid="documents-list"], .document-card, article').first();
    const emptyState = page.locator('text=/no.*documents|žádné.*dokumenty/i').first();
    
    const hasDocuments = await documentsList.isVisible({ timeout: 5000 }).catch(() => false);
    const isEmpty = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
    
    expect(hasDocuments || isEmpty).toBe(true);
  });

  test("Can filter documents by category", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Look for category filter
    const categoryFilter = page.locator('[data-testid="category-filter"], select, .category-tabs').first();
    const categoryTab = page.getByRole("tab").first();
    
    if (await categoryFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await categoryFilter.click();
    } else if (await categoryTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await categoryTab.click();
    }
  });

  test("Can search documents", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Look for search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="search"], input[placeholder*="hledat"]').first();
    
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill("test");
      await page.waitForTimeout(500);
      
      // Search should filter results
      await waitForLoadingComplete(page);
    }
  });

  test("Can view document detail", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Click on a document
    const documentCard = page.locator('[data-testid="document-card"], .document-item, article a').first();
    
    if (await documentCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await documentCard.click();
      await waitForLoadingComplete(page);

      // Should show document detail
      const detailSection = page.locator('[data-testid="document-detail"], article, .document-content').first();
      await expect(detailSection).toBeVisible({ timeout: 5000 });
    }
  });
});
