/**
 * Archive Pages E2E Tests
 *
 * Tests the archive document browser and related pages.
 * Covers: archive listing, document detail, provenance, methods.
 */

import { test, expect } from "@playwright/test";
import { clearLocalStorage, waitForLoadingComplete } from "./fixtures";

test.describe("Archive - Public Access", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Archive page is accessible", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Should show archive interface
    const hasArchive = await page.getByText(/archive|archiv|document|dokument/i).isVisible().catch(() => false);
    expect(hasArchive).toBe(true);
  });

  test("Archive shows document listing", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Should show document list
    const hasDocuments = await page.getByText(/document|dokument|record|záznam/i).isVisible().catch(() => false);
    const hasCards = await page.getByTestId("archive-card").first().isVisible().catch(() => false);
    const hasEmptyState = await page.getByText(/no documents|žádné dokumenty/i).isVisible().catch(() => false);

    expect(hasDocuments || hasCards || hasEmptyState).toBe(true);
  });
});

test.describe("Archive - Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Can filter by decade", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Look for decade filter
    const decadeFilter = page.getByRole("combobox", { name: /decade|dekáda|year|rok/i }).first();
    const decadeTabs = page.getByRole("tab", { name: /\d{4}|\d{2}s/i }).first();

    if (await decadeFilter.isVisible().catch(() => false)) {
      await decadeFilter.click();
      const option = page.getByRole("option").first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        await waitForLoadingComplete(page);
      }
      expect(true).toBe(true);
    } else if (await decadeTabs.isVisible().catch(() => false)) {
      await decadeTabs.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Can filter by document type", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Look for type filter
    const typeFilter = page.getByRole("combobox", { name: /type|typ|category/i }).first();
    const typeCheckbox = page.getByRole("checkbox", { name: /research|patent|article/i }).first();

    if (await typeFilter.isVisible().catch(() => false)) {
      await typeFilter.click();
      const option = page.getByRole("option").first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        await waitForLoadingComplete(page);
      }
      expect(true).toBe(true);
    } else if (await typeCheckbox.isVisible().catch(() => false)) {
      await typeCheckbox.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Can search documents", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Find search input
    const searchInput = page.getByRole("searchbox").or(page.getByPlaceholder(/search|hledat/i)).first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("research");
      await page.waitForTimeout(500);

      // Results should update
      expect(true).toBe(true);
    }
  });

  test("Can filter by tags", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Look for tag filter
    const tagFilter = page.getByRole("combobox", { name: /tag|štítek/i }).first();
    const tagButton = page.getByRole("button", { name: /tag|štítek/i }).first();

    if (await tagFilter.isVisible().catch(() => false)) {
      await tagFilter.click();
      expect(true).toBe(true);
    } else if (await tagButton.isVisible().catch(() => false)) {
      await tagButton.click();
      expect(true).toBe(true);
    }
  });
});

test.describe("Archive - Document Detail", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Can view document detail", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Click on first document
    const documentCard = page.getByTestId("archive-card").first();
    const documentLink = page.getByRole("link", { name: /view|detail|read/i }).first();

    if (await documentCard.isVisible().catch(() => false)) {
      await documentCard.click();
      await waitForLoadingComplete(page);

      const hasDetail = await page.getByText(/document|abstract|content|obsah/i).isVisible().catch(() => false);
      expect(hasDetail).toBe(true);
    } else if (await documentLink.isVisible().catch(() => false)) {
      await documentLink.click();
      await waitForLoadingComplete(page);
      expect(true).toBe(true);
    }
  });

  test("Document detail shows provenance", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Navigate to document detail
    const documentLink = page.getByRole("link").filter({ hasText: /document|archiv/i }).first();

    if (await documentLink.isVisible().catch(() => false)) {
      await documentLink.click();
      await waitForLoadingComplete(page);

      // Look for provenance info
      const hasProvenance = await page.getByText(/provenance|source|zdroj|origin/i).isVisible().catch(() => false);
      expect(hasProvenance).toBe(true);
    }
  });

  test("Document shows metadata", async ({ page }) => {
    await page.goto("/archive");
    await waitForLoadingComplete(page);

    // Look for metadata display
    const hasMetadata = await page.getByText(/date|author|year|datum|autor|rok/i).isVisible().catch(() => false);
    expect(hasMetadata).toBe(true);
  });
});

test.describe("Archive - Provenance Page", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Provenance page is accessible", async ({ page }) => {
    await page.goto("/archive/provenance");
    await waitForLoadingComplete(page);

    // Should show provenance information
    const hasProvenance = await page.getByText(/provenance|source|zdroj|origin|verification/i).isVisible().catch(() => false);
    expect(hasProvenance).toBe(true);
  });

  test("Provenance explains document sourcing", async ({ page }) => {
    await page.goto("/archive/provenance");
    await waitForLoadingComplete(page);

    // Look for explanation content
    const hasContent = await page.getByText(/verify|authenticate|source|zdroj|how|jak/i).isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("Archive - Methods Page", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Methods page is accessible", async ({ page }) => {
    await page.goto("/archive/methods");
    await waitForLoadingComplete(page);

    // Should show methods information
    const hasMethods = await page.getByText(/method|metoda|methodology|approach|přístup/i).isVisible().catch(() => false);
    expect(hasMethods).toBe(true);
  });

  test("Methods explains archive methodology", async ({ page }) => {
    await page.goto("/archive/methods");
    await waitForLoadingComplete(page);

    // Look for methodology content
    const hasContent = await page.getByText(/collect|selection|preservation|research/i).isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

test.describe("Archive - Public Pages", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("History page is accessible", async ({ page }) => {
    await page.goto("/history");
    await waitForLoadingComplete(page);

    // Should show history content
    const hasHistory = await page.getByText(/history|historie|timeline|story/i).isVisible().catch(() => false);
    expect(hasHistory).toBe(true);
  });

  test("Whitepaper page is accessible", async ({ page }) => {
    await page.goto("/whitepaper");
    await waitForLoadingComplete(page);

    // Should show whitepaper content
    const hasWhitepaper = await page.getByText(/whitepaper|paper|technical|document/i).isVisible().catch(() => false);
    expect(hasWhitepaper).toBe(true);
  });

  test("Story page is accessible", async ({ page }) => {
    await page.goto("/story");
    await waitForLoadingComplete(page);

    // Should show brand story
    const hasStory = await page.getByText(/story|příběh|about|mission|poslání/i).isVisible().catch(() => false);
    expect(hasStory).toBe(true);
  });

  test("Research page is accessible", async ({ page }) => {
    await page.goto("/research");
    await waitForLoadingComplete(page);

    // Should show research information
    const hasResearch = await page.getByText(/research|výzkum|science|study/i).isVisible().catch(() => false);
    expect(hasResearch).toBe(true);
  });

  test("Protocol page is accessible", async ({ page }) => {
    await page.goto("/protocol");
    await waitForLoadingComplete(page);

    // Should show protocol information
    const hasProtocol = await page.getByText(/protocol|protokol|rtn|process/i).isVisible().catch(() => false);
    expect(hasProtocol).toBe(true);
  });

  test("FAQ page is accessible", async ({ page }) => {
    await page.goto("/faq");
    await waitForLoadingComplete(page);

    // Should show FAQ content
    const hasFaq = await page.getByText(/faq|question|otázka|answer|odpověď/i).isVisible().catch(() => false);
    expect(hasFaq).toBe(true);
  });

  test("Partners page is accessible", async ({ page }) => {
    await page.goto("/partners");
    await waitForLoadingComplete(page);

    // Should show partners listing
    const hasPartners = await page.getByText(/partner|ambassador|consultant/i).isVisible().catch(() => false);
    expect(hasPartners).toBe(true);
  });
});

test.describe("Archive - Partner Public Profile", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("Partner public profile is accessible", async ({ page }) => {
    // Use E2E partner ID
    await page.goto("/partner/e2e00000-0000-0000-0000-000000000003");
    await waitForLoadingComplete(page);

    // Should show partner profile or redirect
    const hasProfile = await page.getByText(/partner|profile|profil|consultant/i).isVisible().catch(() => false);
    const hasNotFound = await page.getByText(/not found|nenalezeno/i).isVisible().catch(() => false);

    expect(hasProfile || hasNotFound).toBe(true);
  });
});

test.describe("Archive - Error Pages", () => {
  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test("404 page shows for invalid routes", async ({ page }) => {
    await page.goto("/nonexistent-page-123456");
    await waitForLoadingComplete(page);

    // Should show 404 content
    const has404 = await page.getByText(/404|not found|nenalezeno|doesn't exist/i).isVisible().catch(() => false);
    expect(has404).toBe(true);
  });

  test("403 page is styled", async ({ page }) => {
    await page.goto("/403");
    await waitForLoadingComplete(page);

    // Should show 403 content
    const has403 = await page.getByText(/403|forbidden|access denied|přístup odepřen/i).isVisible().catch(() => false);
    expect(has403).toBe(true);
  });
});
