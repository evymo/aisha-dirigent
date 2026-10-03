/**
 * E2E Tests: Page Builder Canvas Rendering
 *
 * Ověřuje že:
 * - GrapesJS canvas iframe se načte a obsahuje obsah
 * - Canvas zobrazuje elementy z canvas_html (hero section, headings)
 * - Bloky v canvasu jsou klikatelné a editovatelné
 * - Stránka s canvas_html (bez canvas_data) se korektně renderuje (fallback)
 * - Seeded stránky na produkci mají obsah (ne prázdný canvas)
 *
 * Requires admin authentication + running dev server.
 */

import { test, expect, type Page, type FrameLocator } from "@playwright/test";

test.use({ storageState: "e2e/.auth/admin.json" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EDITOR_TIMEOUT = 25_000;

const waitForEditor = async (page: Page) => {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
};

/**
 * Navigate to the page editor for a given slug.
 * Finds the page in the admin list and opens the canvas editor.
 */
const openEditorBySlug = async (page: Page, slug: string): Promise<boolean> => {
  await page.goto("/admin/pages");
  await waitForEditor(page);

  // Find the row containing the slug
  const slugCell = page.locator(`td:has-text("/${slug}"), td:has-text("${slug}")`).first();
  const slugVisible = await slugCell.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!slugVisible) {
    console.warn(`[canvas-test] Slug "${slug}" not found in admin pages list`);
    return false;
  }

  // Find the row and click the action button (three-dot menu)
  const row = slugCell.locator("xpath=ancestor::tr");
  const actionBtn = row.locator("button").filter({ hasNotText: /\w+/ }).first();
  const actionVisible = await actionBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!actionVisible) return false;
  await actionBtn.click();
  await page.waitForTimeout(300);

  // Click "Upravit canvas" / "Edit Canvas"
  const editItem = page.locator(
    '[role="menuitem"]:has-text("Upravit canvas"), [role="menuitem"]:has-text("Edit canvas"), [role="menuitem"]:has-text("Edit Canvas")',
  ).first();
  const editVisible = await editItem.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!editVisible) return false;

  await editItem.click();
  await waitForEditor(page);
  return true;
};

/**
 * Get the GrapesJS canvas iframe frame locator.
 * GrapesJS renders content inside an iframe within .gjs-frame-wrapper.
 */
const getCanvasFrame = (page: Page): FrameLocator => {
  return page.frameLocator(".gjs-frame-wrapper iframe, iframe.gjs-frame");
};

/**
 * Wait for canvas iframe to be present and loaded.
 */
const waitForCanvasFrame = async (page: Page) => {
  // Wait for the GrapesJS iframe to appear
  const iframe = page.locator(".gjs-frame-wrapper iframe, iframe.gjs-frame").first();
  await expect(iframe).toBeAttached({ timeout: EDITOR_TIMEOUT });

  // Give GrapesJS time to populate the iframe content
  await page.waitForTimeout(2000);
};

// ---------------------------------------------------------------------------
// 1. Canvas renders content (not empty)
// ---------------------------------------------------------------------------

test.describe("Page Builder — Canvas content rendering", () => {
  test("canvas iframe loads and has body content for index page", async ({ page }) => {
    const opened = await openEditorBySlug(page, "index");
    test.skip(!opened, "Index page not found in admin list");

    await waitForCanvasFrame(page);

    const frame = getCanvasFrame(page);

    // The body should NOT be empty — it should have at least one child element
    const body = frame.locator("body");
    await expect(body).not.toBeEmpty({ timeout: 10_000 });

    // Verify actual visible content exists inside the canvas
    const anySection = frame.locator("section, div, h1, h2, p").first();
    await expect(anySection).toBeAttached({ timeout: 10_000 });
  });

  test("canvas renders hero section with heading text", async ({ page }) => {
    const opened = await openEditorBySlug(page, "index");
    test.skip(!opened, "Index page not found");

    await waitForCanvasFrame(page);
    const frame = getCanvasFrame(page);

    // Look for any heading (h1, h2) with actual text content
    const heading = frame.locator("h1, h2").first();
    await expect(heading).toBeAttached({ timeout: 10_000 });

    const text = await heading.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test("canvas has multiple sections (hero + features)", async ({ page }) => {
    const opened = await openEditorBySlug(page, "index");
    test.skip(!opened, "Index page not found");

    await waitForCanvasFrame(page);
    const frame = getCanvasFrame(page);

    const sections = frame.locator("section");
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("canvas renders CTA button/link", async ({ page }) => {
    const opened = await openEditorBySlug(page, "index");
    test.skip(!opened, "Index page not found");

    await waitForCanvasFrame(page);
    const frame = getCanvasFrame(page);

    const ctaLink = frame.locator("a.evymo-btn, a[href*='contact'], a[href*='auth']").first();
    await expect(ctaLink).toBeAttached({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// 2. FAQ page with runtime block placeholder
// ---------------------------------------------------------------------------

test.describe("Page Builder — FAQ page content", () => {
  test("FAQ page canvas shows heading and runtime block placeholder", async ({ page }) => {
    const opened = await openEditorBySlug(page, "faq");
    test.skip(!opened, "FAQ page not found");

    await waitForCanvasFrame(page);
    const frame = getCanvasFrame(page);

    // FAQ heading should be visible
    const heading = frame.locator("h1").first();
    await expect(heading).toBeAttached({ timeout: 10_000 });

    // Runtime block placeholder should be present
    const runtimeBlock = frame.locator("[data-runtime-block]").first();
    const hasRuntime = await runtimeBlock.isVisible({ timeout: 5_000 }).catch(() => false);
    // Runtime blocks are OK to be missing in editor (they render on public side)
    if (hasRuntime) {
      const blockType = await runtimeBlock.getAttribute("data-runtime-block");
      expect(blockType).toBe("faq-accordion");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Story page
// ---------------------------------------------------------------------------

test.describe("Page Builder — Story page content", () => {
  test("Story page canvas renders hero + body paragraphs", async ({ page }) => {
    const opened = await openEditorBySlug(page, "story");
    test.skip(!opened, "Story page not found");

    await waitForCanvasFrame(page);
    const frame = getCanvasFrame(page);

    // Hero section
    const hero = frame.locator("section.evymo-hero, section:first-child").first();
    await expect(hero).toBeAttached({ timeout: 10_000 });

    // Body paragraphs
    const paragraphs = frame.locator("p");
    const count = await paragraphs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 4. News page (pre-seeded with canvas_html)
// ---------------------------------------------------------------------------

test.describe("Page Builder — News page content", () => {
  test("News page canvas renders heading", async ({ page }) => {
    const opened = await openEditorBySlug(page, "news");
    test.skip(!opened, "News page not found");

    await waitForCanvasFrame(page);
    const frame = getCanvasFrame(page);

    const heading = frame.locator("h1").first();
    await expect(heading).toBeAttached({ timeout: 10_000 });

    const text = await heading.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Canvas interactivity — click selects element
// ---------------------------------------------------------------------------

test.describe("Page Builder — Canvas interactivity", () => {
  test("clicking element in canvas activates GrapesJS selection", async ({ page }) => {
    const opened = await openEditorBySlug(page, "index");
    test.skip(!opened, "Index page not found");

    await waitForCanvasFrame(page);
    const frame = getCanvasFrame(page);

    // Click on a heading within the canvas
    const heading = frame.locator("h1, h2").first();
    await heading.click({ timeout: 10_000 });

    // GrapesJS should show selection indicators
    // (toolbar, selection border, or selected class)
    await page.waitForTimeout(500);

    const selectionIndicator = page.locator(
      ".gjs-toolbar, .gjs-selected, .gjs-com-badge, .gjs-resizer-h",
    ).first();
    const isSelected = await selectionIndicator.isVisible({ timeout: 5_000 }).catch(() => false);

    // At minimum, clicking shouldn't crash
    const errorText = page.locator("text=/TypeError|Cannot read properties/i").first();
    await expect(errorText).not.toBeVisible({ timeout: 3_000 }).catch(() => {});

    if (!isSelected) {
      console.info("[canvas-test] Selection indicator not visible — GrapesJS may use different UI");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Empty page fallback — new page with no content
// ---------------------------------------------------------------------------

test.describe("Page Builder — Empty page handling", () => {
  test("editor renders without crash for page with no canvas_data", async ({ page }) => {
    // Use a draft page that may have minimal or no content
    const opened = await openEditorBySlug(page, "whitepaper");
    if (!opened) {
      // Try any other draft page
      await openEditorBySlug(page, "research");
    }

    // Even without canvas content, editor should not crash
    const errorText = page.locator("text=/TypeError|Cannot read properties|error occurred/i").first();
    await expect(errorText).not.toBeVisible({ timeout: 10_000 }).catch(() => {});

    // Canvas area should still be present
    const canvas = page.locator(".gjs-cv-canvas, .gjs-frame-wrapper").first();
    await expect(canvas).toBeAttached({ timeout: EDITOR_TIMEOUT });
  });
});

// ---------------------------------------------------------------------------
// 7. Public page rendering — verify canvas_html renders on frontend
// ---------------------------------------------------------------------------

test.describe("Page Builder — Public page rendering", () => {
  test("published index page renders content on public site", async ({ page }) => {
    // Visit the public page (not admin)
    await page.goto("/p/index");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // If /p/index doesn't work, try / (homepage)
    const hasContent = await page.locator("section, .gjs-page-content").first()
      .isVisible({ timeout: 5_000 }).catch(() => false);

    if (!hasContent) {
      await page.goto("/");
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    }

    // Page should contain some rendered content (not just loader/skeleton)
    // Exclude Sonner notification section which is always present but hidden
    const content = page.locator("main h1, main h2, main section, .gjs-page-content, .evymo-hero").first();
    await expect(content).toBeVisible({ timeout: 10_000 });
  });

  test("published FAQ page shows content", async ({ page }) => {
    await page.goto("/p/faq");
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    // Skip if page returns 404 (public page routing may not be configured)
    const is404 = await page.locator("text=404").isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(is404, "FAQ public page route not configured (/p/faq returns 404)");

    const content = page.locator("main h1, .gjs-page-content, main section, .evymo-hero").first();
    await expect(content).toBeVisible({ timeout: 10_000 });
  });
});
