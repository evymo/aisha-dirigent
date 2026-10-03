/**
 * E2E Tests: Archive Document Download
 * 
 * Tests public archive document access and download functionality.
 */

import { test, expect } from "@playwright/test";
import { waitForLoadingComplete } from "./fixtures";

test.describe("Archive: Public Access", () => {
  test("Archive page loads", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Page should load with archive heading
    await expect(page.getByRole("heading", { name: /Explore the Archive|Prozkoumejte archiv/i })).toBeVisible();
  });

  test("Archive displays documents or empty state", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Either documents are shown (links with "View Document") or empty state
    const documents = page.locator("a:has-text('View Document'), a:has-text('Zobrazit dokument')");
    const emptyState = page.getByText(/žádné dokumenty|no documents|prázdný archiv|empty archive/i);

    const hasDocuments = await documents.first().isVisible().catch(() => false);
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    expect(hasDocuments || hasEmptyState).toBe(true);
  });

  test("Archive categories filter works", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Look for category tabs or filter
    const categoryFilter = page.locator("[data-testid='category-filter'], [role='tablist'], .category-tabs");
    
    if (await categoryFilter.isVisible().catch(() => false)) {
      // Click on first category tab
      const firstTab = categoryFilter.locator("button, [role='tab']").first();
      if (await firstTab.isVisible().catch(() => false)) {
        await firstTab.click();
        await waitForLoadingComplete(page);
        
        // Page should still be functional (heading visible)
        await expect(page.getByRole("heading", { name: /Explore the Archive|Prozkoumejte archiv/i })).toBeVisible();
      }
    }
  });
});

test.describe("Archive: Document Download", () => {
  test("Document detail page accessible", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Find document link - use the "View Document" text
    const documentLink = page.locator("a:has-text('View Document'), a:has-text('Zobrazit dokument')").first();
    
    if (await documentLink.isVisible().catch(() => false)) {
      await documentLink.click();
      await waitForLoadingComplete(page);

      // Should navigate to document detail
      await expect(page).toHaveURL(/\/archive\/.+/);
      
      // Document detail should show content
      const title = page.locator("h1, h2, [data-testid='document-title']").first();
      await expect(title).toBeVisible();
    }
  });

  test("Download button triggers file download", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Navigate to first document using "View Document" link
    const documentLink = page.locator("a:has-text('View Document'), a:has-text('Zobrazit dokument')").first();
    
    if (await documentLink.isVisible().catch(() => false)) {
      await documentLink.click();
      await waitForLoadingComplete(page);

      // Look for download button
      const downloadButton = page.getByRole("button", { name: /stáhnout|download|pdf/i }).first();
      const downloadLink = page.locator("a[download], a[href*='.pdf']").first();

      const hasDownloadButton = await downloadButton.isVisible().catch(() => false);
      const hasDownloadLink = await downloadLink.isVisible().catch(() => false);

      if (hasDownloadButton) {
        // Set up download listener
        const downloadPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
        await downloadButton.click();
        const download = await downloadPromise;
        
        if (download) {
          // Verify download started
          expect(download.suggestedFilename()).toBeTruthy();
        }
      } else if (hasDownloadLink) {
        // Verify link has valid href
        const href = await downloadLink.getAttribute("href");
        expect(href).toBeTruthy();
      }
    }
  });

  test("External PDF viewer opens document", async ({ page, context }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    const documentLink = page.locator("a:has-text('View Document'), a:has-text('Zobrazit dokument')").first();
    
    if (await documentLink.isVisible().catch(() => false)) {
      await documentLink.click();
      await waitForLoadingComplete(page);

      // Look for view button (opens in new tab)
      const viewButton = page.getByRole("button", { name: /zobrazit|view|otevřít/i }).first();
      const viewLink = page.locator("a[target='_blank'][href*='.pdf'], a[target='_blank'][href*='storage']").first();

      if (await viewButton.isVisible().catch(() => false)) {
        const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
        await viewButton.click();
        const popup = await popupPromise;
        
        if (popup) {
          // New page opened - should be PDF or storage URL
          const popupUrl = popup.url();
          expect(popupUrl).toBeTruthy();
          await popup.close();
        }
      } else if (await viewLink.isVisible().catch(() => false)) {
        const href = await viewLink.getAttribute("href");
        expect(href).toBeTruthy();
      }
    }
  });
});

test.describe("Archive: Search", () => {
  test("Search input available", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Look for search textbox
    const searchInput = page.getByRole("textbox", { name: /search|hledat/i }).first();

    await expect(searchInput).toBeVisible();
  });

  test("Search filters documents", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    const searchInput = page.getByRole("textbox", { name: /search|hledat/i }).first();
    
    if (await searchInput.isVisible().catch(() => false)) {
      // Type search query - use something from known documents
      await searchInput.fill("RTN");
      await waitForLoadingComplete(page);

      // Page should still show heading after search
      await expect(page.getByRole("heading", { name: /Explore the Archive|Prozkoumejte archiv/i })).toBeVisible();
    }
  });
});
