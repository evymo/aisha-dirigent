/**
 * E2E Framework — Enhanced Helpers
 *
 * Extends the base fixtures.ts with higher-level helpers
 * for common E2E scenarios.  Import these in your spec files
 * instead of re-inventing navigation / assertion patterns.
 */

import { Page, expect } from '@playwright/test';
import { waitForLoadingComplete } from '../fixtures';

// ---------------------------------------------------------------------------
// Navigation Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to a route and wait until content is visible.
 * Returns HTTP status for further assertions.
 */
export async function navigateTo(
  page: Page,
  url: string,
  options?: { timeout?: number },
): Promise<number> {
  const timeout = options?.timeout ?? 15_000;
  const response = await page.goto(url, { timeout });
  await waitForLoadingComplete(page);
  return response?.status() ?? 0;
}

/**
 * Navigate to a page and assert it renders without errors.
 * Combined "go + wait + assert" in one call.
 */
export async function navigateAndAssert(
  page: Page,
  url: string,
  options?: { slow?: boolean },
) {
  const timeout = options?.slow ? 30_000 : 15_000;
  const status = await navigateTo(page, url, { timeout });
  expect(status).toBeLessThan(400);

  const bodyText = await page.locator('body').textContent();
  expect(bodyText).not.toContain('Not Found');
}

// ---------------------------------------------------------------------------
// Assertion Helpers
// ---------------------------------------------------------------------------

/**
 * Assert a visible heading (h1-h3 or text-2xl/text-xl class).
 */
export async function expectHeading(page: Page, textPattern?: RegExp) {
  const headingLoc = page.locator(
    'h1, h2, h3, [role="heading"], [class*="text-2xl"], [class*="text-xl"]',
  );

  if (textPattern) {
    await expect(headingLoc.filter({ hasText: textPattern }).first()).toBeVisible({ timeout: 5_000 });
  } else {
    await expect(headingLoc.first()).toBeVisible({ timeout: 5_000 });
  }
}

/**
 * Assert a visible table (including role="grid" for Data Tables).
 */
export async function expectTable(page: Page) {
  const table = page.locator('table, [role="table"], [role="grid"]').first();
  await expect(table).toBeVisible({ timeout: 10_000 });
}

/**
 * Assert a specific toast notification appeared.
 */
export async function expectToast(page: Page, textPattern: RegExp | string) {
  const toast = page.locator(
    '[role="status"], [data-sonner-toast], .toast, [class*="toast"]',
  );
  await expect(toast.filter({ hasText: textPattern })).toBeVisible({ timeout: 5_000 });
}

/**
 * Assert the page redirected to /auth (for unauthenticated access tests).
 */
export async function expectAuthRedirect(page: Page) {
  await page.waitForURL(/\/(auth|login)/, { timeout: 10_000 });
}

/**
 * Assert the page shows an access denied message or redirected away.
 */
export async function expectAccessDenied(page: Page, originalUrl: string) {
  const onOriginal = page.url().includes(originalUrl);
  if (onOriginal) {
    const denied = page.getByText(
      /access denied|unauthorized|forbidden|nemáte oprávnění|přístup odepřen/i,
    );
    await expect(denied).toBeVisible({ timeout: 5_000 });
  }
  // If not on original URL → was redirected away, which is also acceptable
}

// ---------------------------------------------------------------------------
// Console Error Collector
// ---------------------------------------------------------------------------

export interface ConsoleCollector {
  errors: string[];
  start: () => void;
  stop: () => void;
}

/**
 * Create a console error collector for a page.
 * Use in tests where you want to assert no JS errors on a page.
 */
export function createConsoleCollector(page: Page): ConsoleCollector {
  const errors: string[] = [];

  const handler = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Ignore known benign errors
    if (text.includes('favicon') || text.includes('net::ERR_')) return;
    errors.push(text);
  };

  return {
    errors,
    start: () => page.on('console', handler),
    stop: () => page.off('console', handler),
  };
}

// ---------------------------------------------------------------------------
// Form Helpers
// ---------------------------------------------------------------------------

/**
 * Fill a form by mapping field name → value.
 */
export async function fillForm(
  page: Page,
  fields: Record<string, string>,
) {
  for (const [name, value] of Object.entries(fields)) {
    const input = page.locator(`[name="${name}"], [id="${name}"]`).first();
    await input.fill(value);
  }
}

/**
 * Click a submit button and optionally wait for a network response.
 */
export async function submitForm(
  page: Page,
  options?: { waitForUrl?: RegExp },
) {
  const submit = page.locator('button[type="submit"]').first();

  if (options?.waitForUrl) {
    const [response] = await Promise.all([
      page.waitForResponse(options.waitForUrl, { timeout: 15_000 }),
      submit.click(),
    ]);
    return response;
  }

  await submit.click();
  return null;
}

// ---------------------------------------------------------------------------
// Screenshot Helper
// ---------------------------------------------------------------------------

/**
 * Take a debug screenshot with a timestamped name.
 */
export async function debugScreenshot(page: Page, label: string) {
  await page.screenshot({
    path: `e2e/screenshots/debug-${label}-${Date.now()}.png`,
    fullPage: true,
  });
}
