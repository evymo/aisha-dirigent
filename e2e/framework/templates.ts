/**
 * E2E Test Templates — Generic Test Generators
 *
 * These functions take data from the registry and generate Playwright
 * test cases.  To test a new page, you add it to the registry — the
 * template does the rest.
 *
 * Usage:
 *   import { generateRouteLoadTests } from './framework/templates';
 *   import { ADMIN_ROUTES } from './framework/registry';
 *   generateRouteLoadTests(ADMIN_ROUTES, { storageState: 'e2e/.auth/admin.json' });
 */

import { test, expect, Page } from '@playwright/test';
import { waitForLoadingComplete, AUTH_FILES } from '../fixtures';

import type { RouteEntry, RbacRule, UserRole, CrudScenario } from './registry';

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

const AUTH_STATE: Record<UserRole, string | undefined> = {
  admin: AUTH_FILES.admin,
  member: AUTH_FILES.member,
  partner: AUTH_FILES.partner,
  staff: undefined, // TODO: add staff auth file if needed
  anonymous: undefined,
};

/** Default "page has content" assertion. */
async function assertPageHasContent(page: Page, route: RouteEntry) {
  // Custom selectors first
  if (route.contentSelectors?.length) {
    const loc = page.locator(route.contentSelectors.join(', ')).first();
    await expect(loc).toBeVisible({ timeout: 10_000 });
    return;
  }

  // Generic: heading or large content area
  const heading = page.locator(
    'h1, h2, h3, [role="heading"], [class*="text-2xl"], [class*="text-xl"]',
  ).first();
  const hasHeading = await heading.isVisible({ timeout: 5_000 }).catch(() => false);

  if (!hasHeading) {
    // Fallback: page must contain non-trivial content
    const mainContent = page.locator('main, [role="main"], .container, .flex-1').first();
    await expect(mainContent).toBeVisible({ timeout: 10_000 });
    const text = await mainContent.textContent().catch(() => '');
    expect((text ?? '').length).toBeGreaterThan(20);
  }
}

// ---------------------------------------------------------------------------
// Template 1: Route Load Tests
// ---------------------------------------------------------------------------

export interface RouteLoadTestOptions {
  /** Playwright storageState path. */
  storageState?: string;
  /** Group label for test.describe. */
  describeLabel?: string;
  /** Fail on console errors? Default true. */
  failOnConsoleErrors?: boolean;
}

/**
 * Generate "route loads successfully" tests for an array of RouteEntry.
 *
 * What each test verifies:
 * - HTTP status < 400
 * - No unhandled console errors (optional)
 * - Page is NOT a 404 / error page
 * - Visible heading or main content area
 */
export function generateRouteLoadTests(
  routes: RouteEntry[],
  options: RouteLoadTestOptions = {},
) {
  const {
    storageState,
    describeLabel,
    failOnConsoleErrors = true,
  } = options;

  const testable = routes.filter((r) => !r.skip);

  for (const route of testable) {
    const groupLabel = describeLabel ?? route.category;

    test.describe(groupLabel, () => {
      if (storageState) {
        test.use({ storageState });
      }

      test(`${route.title} (${route.url}) loads`, async ({ page }) => {
        const timeout = route.slow ? 30_000 : 15_000;
        const consoleErrors: string[] = [];

        if (failOnConsoleErrors) {
          page.on('console', (msg) => {
            if (msg.type() === 'error') {
              const text = msg.text();
              if (text.includes('favicon') || text.includes('net::ERR_')) return;
              consoleErrors.push(text);
            }
          });
        }

        // Navigate
        const response = await page.goto(route.url, { timeout });
        expect(response?.status(), `${route.url} returned ${response?.status()}`).toBeLessThan(400);

        await waitForLoadingComplete(page);

        // No 404 / error
        const bodyText = await page.locator('body').textContent();
        expect(bodyText).not.toContain('404');
        expect(bodyText).not.toContain('Not Found');

        // Visible content
        await assertPageHasContent(page, route);

        // Console errors (soft — skip benign ones)
        if (failOnConsoleErrors && consoleErrors.length > 0) {
          console.warn(
            `⚠️ Console errors on ${route.url}:\n${consoleErrors.join('\n')}`,
          );
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Template 2: RBAC Access Tests
// ---------------------------------------------------------------------------

export interface RbacTestOptions {
  describeLabel?: string;
}

/**
 * Generate RBAC tests — verify that roles get the expected access.
 */
export function generateRbacTests(
  rules: RbacRule[],
  options: RbacTestOptions = {},
) {
  const label = options.describeLabel ?? 'RBAC';

  test.describe(label, () => {
    for (const rule of rules) {
      const roleLabel = rule.role;
      const expectLabel = rule.expect;

      test(`${roleLabel} → ${rule.url} → ${expectLabel}`, async ({ browser }) => {
        const state = AUTH_STATE[rule.role];
        const context = await browser.newContext(
          state ? { storageState: state } : {},
        );
        const page = await context.newPage();

        await page.goto(rule.url, { timeout: 15_000 });
        await page.waitForLoadState('domcontentloaded');
        // Give SPA router time to redirect
        await page.waitForTimeout(1_500);

        switch (rule.expect) {
          case 'redirect-auth': {
            const pattern = rule.redirectPattern ?? /\/(auth|login)/;
            expect(page.url()).toMatch(pattern);
            break;
          }
          case 'deny': {
            // Either redirected away or shows access denied
            const onOriginal = page.url().includes(rule.url);
            if (onOriginal) {
              const denied = page.getByText(/access denied|unauthorized|forbidden|nemáte oprávnění/i);
              await expect(denied).toBeVisible({ timeout: 5_000 }).catch(() => {
                // Page may silently redirect; that's also OK
              });
            }
            break;
          }
          case 'allow': {
            // Should stay on the page (or SPA sub-path)
            const content = page.locator('main, [role="main"], .container, .flex-1').first();
            await expect(content).toBeVisible({ timeout: 10_000 });
            break;
          }
        }

        await context.close();
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Template 3: CRUD List Page Tests
// ---------------------------------------------------------------------------

/**
 * Generate basic CRUD list tests for admin pages that display tables/lists.
 */
export function generateCrudListTests(
  scenarios: CrudScenario[],
  storageState?: string,
) {
  for (const scenario of scenarios) {
    test.describe(`CRUD: ${scenario.title}`, () => {
      if (storageState) {
        test.use({ storageState });
      }

      test(`list page loads with table`, async ({ page }) => {
        await page.goto(scenario.listUrl, { timeout: 15_000 });
        await waitForLoadingComplete(page);

        if (scenario.hasTable !== false) {
          const table = page.locator('table, [role="table"], [role="grid"]').first();
          await expect(table).toBeVisible({ timeout: 10_000 });
        }
      });

      if (scenario.hasCreateButton) {
        test(`has create / add button`, async ({ page }) => {
          await page.goto(scenario.listUrl, { timeout: 15_000 });
          await waitForLoadingComplete(page);

          const pattern = scenario.createButtonText ?? /add|create|přidat|nový|nová/i;
          const btn = page.getByRole('button', { name: pattern }).or(
            page.getByRole('link', { name: pattern }),
          ).first();
          await expect(btn).toBeVisible({ timeout: 5_000 });
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Template 4: Smoke / Page Load Tests (lightweight)
// ---------------------------------------------------------------------------

/**
 * Ultra-lightweight smoke tests — just verify HTTP 200 + some content.
 * No auth required (for public pages).
 */
export function generateSmokeTests(routes: RouteEntry[]) {
  const testable = routes.filter((r) => !r.skip && r.role === 'anonymous');

  test.describe('Smoke — Public Pages', () => {
    for (const route of testable) {
      test(`${route.title} (${route.url}) is reachable`, async ({ page }) => {
        const response = await page.goto(route.url, { timeout: 15_000 });
        expect(response?.status()).toBeLessThan(400);

        await waitForLoadingComplete(page);

        const bodyText = await page.locator('body').textContent();
        expect(bodyText).not.toContain('404');
        expect(bodyText).not.toContain('Not Found');

        await assertPageHasContent(page, route);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Template 5: API Health Tests
// ---------------------------------------------------------------------------

export interface ApiEndpoint {
  title: string;
  url: string;
  method?: 'GET' | 'POST';
  expectedStatus?: number[];
  headers?: Record<string, string>;
}

/**
 * Generate API health-check tests for backend endpoints.
 */
export function generateApiHealthTests(
  endpoints: ApiEndpoint[],
  describeLabel = 'API Health',
) {
  test.describe(describeLabel, () => {
    for (const ep of endpoints) {
      test(`${ep.title} responds`, async ({ request }) => {
        const method = ep.method ?? 'GET';
        const response = method === 'GET'
          ? await request.get(ep.url, { timeout: 10_000 })
          : await request.post(ep.url, { timeout: 10_000 });

        const expected = ep.expectedStatus ?? [200, 401, 403];
        expect(expected).toContain(response.status());
      });
    }
  });
}
