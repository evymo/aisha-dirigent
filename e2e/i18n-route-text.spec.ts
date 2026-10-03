/**
 * i18n-route-text.spec.ts — acceptance: the correct web is served, every public
 * route renders real text, and NOTHING leaks a raw i18n key.
 *
 * "na vsech adresach jsou texty a vse je v klicich pochazi to z instance data":
 *   - each public route must render visible, non-trivial text (not a blank page
 *     / bare spinner / error shell),
 *   - no visible text may be a raw i18n key (e.g. "web.hero.title") — which is
 *     what react-i18next renders (fallbackLng='en', no missing-key handler) when
 *     a key is absent from the instance-data-sourced 'web' namespace.
 *
 * Runs against a DEPLOYED platform via the prod config (E2E_BASE_URL). It reads
 * ONLY public content — no auth, no writes.
 */
import { test, expect, type Page } from "@playwright/test";

// Public, non-parameterized routes (from src/router.tsx). Auth-gated / :param
// routes are intentionally excluded — this asserts the public surface.
const PUBLIC_ROUTES = [
  "/",
  "/faq",
  "/getting-started",
  "/disclaimer",
  "/legal-disclaimer",
  "/privacy",
  "/privacy-policy",
  "/informed-consent",
  "/marketplace",
  "/news",
  "/research",
  "/references",
  "/solution",
  "/protocol",
  "/archive/methods",
  "/archive/provenance",
  "/remove-account",
  "/study-registration",
];

// A visible text node that is ENTIRELY a lowercase dotted identifier with 2+
// segments (no spaces, no capitals) is almost certainly a leaked i18n key
// ("web.hero.title", "knowledge.subtitle"). Real UI copy has spaces/casing.
const RAW_KEY_RE = /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+){1,}$/;
// Benign dotted tokens that legitimately appear as user-facing text.
const IGNORE = new Set(["e.g", "i.e", "aisha.guru", "id3a.cz"]);

async function visibleTextNodes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = (n.textContent ?? "").trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      out.push(t);
    }
    return out;
  });
}

test.describe("i18n route-text acceptance (public web)", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`route ${route} renders text with no raw i18n keys`, async ({ page }) => {
      const resp = await page.goto(route, { waitUntil: "networkidle", timeout: 30_000 });
      // Route may 200 or redirect; both are fine as long as we land on a rendered page.
      expect(resp, `no response for ${route}`).not.toBeNull();
      expect(resp!.status(), `${route} returned server error`).toBeLessThan(500);

      // Let the SPA hydrate + i18n resolve.
      await page.waitForLoadState("networkidle");
      await page.locator("body").waitFor({ state: "visible", timeout: 10_000 });

      const texts = await visibleTextNodes(page);

      // 1. the page must render REAL content (not blank / spinner-only).
      const meaningful = texts.filter((t) => t.replace(/\s+/g, "").length >= 3);
      expect(meaningful.length, `${route} rendered no visible text (blank/error shell)`).toBeGreaterThan(0);

      // 2. no visible text node may be a raw i18n key.
      const leaked = texts.filter((t) => RAW_KEY_RE.test(t) && !IGNORE.has(t));
      expect(leaked, `${route} shows raw i18n key(s): ${leaked.join(", ")}`).toEqual([]);
    });
  }
});
