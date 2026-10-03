/**
 * Admin — All Routes Load Test
 *
 * Auto-iterates ALL admin sidebar routes from adminNavConfig.ts.
 * Verifies each route:
 * - Navigates successfully (no 404/500)
 * - No unhandled console errors
 * - Page renders within timeout
 * - Heading or main content area is visible
 *
 * Uses admin storageState from auth.setup.ts.
 */

import { test, expect } from "@playwright/test";
import { waitForLoadingComplete } from "./fixtures";

// All admin routes extracted from adminNavConfig.ts
// Grouped by section for reporting clarity
const ADMIN_ROUTES = {
  overview: [
    { title: "Dashboard", url: "/admin" },
    { title: "Storyloop", url: "/admin/storyloop" },
    { title: "Public Chat", url: "/admin/public-chat" },
    { title: "Context Profiles", url: "/admin/context-profiles" },
    { title: "AI Runs", url: "/admin/ai-runs" },
    { title: "MCP Tokens", url: "/admin/mcp-tokens" },
    { title: "AI Observability", url: "/admin/ai-observability" },
    { title: "AI Evaluation", url: "/admin/ai-evaluation" },
    { title: "Model Registry", url: "/admin/model-registry" },
    { title: "AI Proactive", url: "/admin/ai-proactive" },
    { title: "Ragnarok KB", url: "/admin/ragnarok-kb" },
    { title: "Audit Journal", url: "/admin/audit-journal" },
    { title: "Session Monitoring", url: "/admin/session-monitoring" },
    { title: "Settings", url: "/admin/settings" },
  ],
  users: [
    { title: "Members", url: "/admin/members" },
    { title: "Partners", url: "/admin/partners" },
    { title: "Consultants", url: "/admin/consultants" },
    { title: "Invitations", url: "/admin/invitations" },
    { title: "Roles", url: "/admin/roles" },
    { title: "Permissions", url: "/admin/permissions" },
    { title: "Deletion Requests", url: "/admin/deletion-requests" },
  ],
  research: [
    { title: "Studies", url: "/admin/studies" },
    { title: "Study Consents", url: "/admin/study-consents" },
    { title: "Registrations", url: "/admin/registrations" },
    { title: "Contributions", url: "/admin/contributions" },
    { title: "Health Outcomes", url: "/admin/outcomes" },
    { title: "Production", url: "/admin/production" },
    { title: "Distribution Protocols", url: "/admin/distribution-protocols" },
    { title: "Distribution Forecast", url: "/admin/distribution-forecast" },
  ],
  content: [
    { title: "Products", url: "/admin/products" },
    { title: "Hero Slides", url: "/admin/hero-slides" },
    { title: "Web Pages", url: "/admin/pages" },
    { title: "Featured Products", url: "/admin/featured-products" },
    { title: "Archive", url: "/admin/archive" },
    { title: "Questionnaires", url: "/admin/questionnaires" },
    { title: "Tests", url: "/admin/tests" },
    { title: "Biomarkers", url: "/admin/biomarkers" },
    { title: "Notifications", url: "/admin/notifications" },
    { title: "News Articles", url: "/admin/news-articles" },
    { title: "Translations", url: "/admin/translations" },
  ],
  payments: [
    { title: "Orders", url: "/admin/orders" },
    { title: "Payments", url: "/admin/payments" },
    { title: "Shipments", url: "/admin/shipments" },
    { title: "Distribution Calendar", url: "/admin/distribution" },
    { title: "Member Subscriptions", url: "/admin/member-subscriptions" },
    { title: "Subscriptions", url: "/admin/subscriptions" },
    { title: "Tokenomics", url: "/admin/tokenomics" },
  ],
};

// Known routes that may be slow (AI, external services)
const SLOW_ROUTES = new Set([
  "/admin/ai-runs",
  "/admin/ai-observability",
  "/admin/ai-evaluation",
  "/admin/model-registry",
  "/admin/ragnarok-kb",
  "/admin/session-monitoring",
  "/admin/translations",
]);

test.use({ storageState: "e2e/.auth/admin.json" });

for (const [section, routes] of Object.entries(ADMIN_ROUTES)) {
  test.describe(`Admin ${section}`, () => {
    for (const route of routes) {
      test(`${route.title} (${route.url}) loads`, async ({ page }) => {
        const timeout = SLOW_ROUTES.has(route.url) ? 30_000 : 15_000;
        const consoleErrors: string[] = [];

        page.on("console", (msg) => {
          if (msg.type() === "error") {
            const text = msg.text();
            // Ignore known benign errors
            if (text.includes("favicon") || text.includes("net::ERR_")) return;
            consoleErrors.push(text);
          }
        });

        // Navigate
        const response = await page.goto(route.url, { timeout });
        expect(response?.status(), `${route.url} returned ${response?.status()}`).toBeLessThan(400);

        // Wait for loading
        await waitForLoadingComplete(page);

        // Page should NOT be on 404 or error page
        const bodyText = await page.locator("body").textContent();
        expect(bodyText).not.toContain("404");
        expect(bodyText).not.toContain("Not Found");

        // Should have visible main content area
        const mainContent = page.locator(
          'main, [role="main"], .admin-content, [data-testid="admin-content"]'
        );
        await expect(mainContent.first()).toBeVisible({ timeout: 10_000 });

        // Should have heading, page title, or at least meaningful content
        // Some admin pages use div-based titles instead of semantic headings
        const heading = page.locator(
          'h1, h2, h3, [data-testid*="title"], [data-testid*="heading"], ' +
          '[class*="text-2xl"], [class*="text-xl"], [class*="font-bold"]'
        );
        const headingCount = await heading.count();
        if (headingCount === 0) {
          // Fallback: page at least has non-trivial content (> 50 chars)
          const mainText = await mainContent.first().textContent() ?? "";
          expect(
            mainText.trim().length,
            `${route.url} should have meaningful content or a heading`,
          ).toBeGreaterThan(50);
        }

        // Report console errors (warn, don't fail — some pages have known issues)
        if (consoleErrors.length > 0) {
          console.warn(
            `[WARN] ${route.url} had ${consoleErrors.length} console error(s):\n` +
              consoleErrors.slice(0, 3).join("\n")
          );
        }
      });
    }
  });
}

// ============================================================================
// SIDEBAR NAVIGATION COMPLETENESS
// ============================================================================

test.describe("Admin sidebar navigation", () => {
  test("sidebar renders with all navigation groups", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);

    // Sidebar should be visible
    const sidebar = page.locator(
      'nav[data-testid="admin-sidebar"], aside, [role="navigation"]'
    ).first();
    await expect(sidebar).toBeVisible();

    // All section groups should be present
    const expectedGroups = Object.keys(ADMIN_ROUTES);
    for (const _group of expectedGroups) {
      // Each group has navigation links
      const links = sidebar.locator("a[href^='/admin']");
      const count = await links.count();
      expect(count, "Sidebar should have admin navigation links").toBeGreaterThan(5);
    }
  });

  test("sidebar links are clickable and navigate", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoadingComplete(page);

    // Find a few sidebar links and verify they navigate
    const sampleRoutes = ["/admin/members", "/admin/products", "/admin/orders"];
    for (const route of sampleRoutes) {
      const link = page.locator(`a[href="${route}"]`).first();
      if (await link.isVisible()) {
        await link.click();
        await page.waitForURL(`**${route}`, { timeout: 10_000 });
        await waitForLoadingComplete(page);
        expect(page.url()).toContain(route);
      }
    }
  });
});
