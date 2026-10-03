/**
 * Storyloop Insight KB — Frontend e2e
 *
 * Validates the UI side of AISHA brain wiring (Layer 5b):
 *   - StoryKnowledgeContext component renders relevant rules from compose_context
 *     ruleset layer (per-story expert_rules with Phase E relevance scoring)
 *   - StoryKnowledgeUpload component is the single entry point for per-story
 *     KB ingest (no parallel pipeline)
 *   - RBAC: admin sees per-story KB controls in any story; partner sees only
 *     their own; member is blocked from admin paths
 *
 * Companion to backend tests:
 *   - scripts/test-brain-wiring.sh (PG layer + RBAC)
 *   - scripts/test-insight-multiturn.sh (Maestro + Ragnarok USP)
 *   - scripts/smoke-insight.sh (full synergy)
 */
import { expect, test } from "@playwright/test";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function waitForLoadingComplete(page: import("@playwright/test").Page) {
  // Skeleton placeholders + spinners settle pattern; storyloop list lazy-loads
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
}

async function clickFirstStory(page: import("@playwright/test").Page) {
  const item = page
    .locator('[data-story-id], [class*="story-item"], button, [role="button"]')
    .filter({ hasText: /pacient|API|sledování|konzultace|reakce/i });
  const count = await item.count();
  if (count === 0) return false;
  await item.first().click();
  await page.waitForTimeout(800);
  return true;
}

// ─── Admin: full access ─────────────────────────────────────────────────────

test.describe("Storyloop Insight KB: Admin", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("admin vidí storyloop a může otevřít detail", async ({ page }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    expect(page.url()).toContain("/admin/storyloop");

    const heading = page.getByRole("heading").first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test("story detail obsahuje Knowledge Context (compose_context ruleset layer)", async ({
    page,
  }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    const opened = await clickFirstStory(page);
    if (!opened) {
      test.skip(true, "No stories visible in test fixture — backend seed needed");
      return;
    }

    const knowledgeContextHeading = page.getByText(
      /Knowledge Context|Kontext znalost|Story Knowledge Context/i,
    );
    const noRulesMessage = page.getByText(/No relevant expert rules|žádná relevantní/i);

    const hasContextSection =
      (await knowledgeContextHeading.count()) > 0 ||
      (await noRulesMessage.count()) > 0;

    expect(hasContextSection).toBe(true);
  });

  test("story detail obsahuje Story Knowledge Base upload (Insight ingest entry)", async ({
    page,
  }) => {
    await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    const opened = await clickFirstStory(page);
    if (!opened) {
      test.skip(true, "No stories visible in test fixture");
      return;
    }

    const kbUpload = page.getByText(/Story Knowledge Base|Story KB|Knowledge Base/i);
    const dropZone = page.getByText(/Přetáhněte|Drag.*drop|Vybrat soubor|Select file/i);

    const hasUploadSection =
      (await kbUpload.count()) > 0 || (await dropZone.count()) > 0;

    expect(hasUploadSection).toBe(true);
  });
});

// ─── Partner: scoped access ──────────────────────────────────────────────────

test.describe("Storyloop Insight KB: Partner", () => {
  test.use({ storageState: "e2e/.auth/partner.json" });

  test("partner storyloop loaduje a obsahuje per-story KB pokud má stories", async ({
    page,
  }) => {
    await page.goto("/partner/storyloop");
    await waitForLoadingComplete(page);

    expect(page.url()).toContain("storyloop");

    const opened = await clickFirstStory(page);
    if (!opened) {
      test.skip(true, "Partner has no assigned stories in fixture");
      return;
    }

    const insightSection = page.getByText(
      /Knowledge Context|Story Knowledge Base|Vybrat soubor|Select file/i,
    );
    expect(await insightSection.count()).toBeGreaterThan(0);
  });
});

// ─── RBAC: member blocked ───────────────────────────────────────────────────

test.describe("Storyloop Insight KB: RBAC", () => {
  test.use({ storageState: "e2e/.auth/member.json" });

  test("member NEMÁ přístup na admin/storyloop (RBAC enforcement)", async ({
    page,
  }) => {
    const resp = await page.goto("/admin/storyloop");
    await waitForLoadingComplete(page);

    // Three valid outcomes that all enforce RBAC:
    //   - HTTP 403/401 (server denied)
    //   - Redirected to /login (client-side guard)
    //   - Page rendered without admin storyloop content (showing "not authorized")
    const isDenied =
      resp?.status() === 403 ||
      resp?.status() === 401 ||
      page.url().includes("/login") ||
      page.url().includes("/forbidden") ||
      (await page.getByText(/forbidden|nemáte oprávnění|unauthor/i).count()) > 0 ||
      !page.url().includes("/admin/storyloop");

    expect(isDenied).toBe(true);
  });
});
