/**
 * Playwright fixtures for driving code-server.
 *
 * Provides:
 *   - `openWorkspace` — loads /workspace, waits for VS Code workbench to be
 *     interactive, closes any auto-opened walkthrough tabs (extension's
 *     setup walkthrough steals focus otherwise).
 *   - `mockBackend` — helpers to configure mock-backend fixtures per-test
 *     and read its call log.
 *
 * Why this dance is necessary: code-server runs VS Code in a browser; the
 * AISHA Dirigent extension auto-opens a Setup walkthrough on activation
 * (good UX in real use, hostile to e2e). The walkthrough is a webview
 * iframe that captures focus — keystrokes never reach the workbench
 * Monaco. We close the walkthrough tabs DOM-side before each test.
 */

import { test as base, type Page, expect } from "@playwright/test";

const MOCK_BACKEND_URL =
  process.env.MOCK_BACKEND_URL ?? "http://127.0.0.1:3030";

export interface MockBackendControl {
  url: string;
  reset: () => Promise<void>;
  configureDispatch: (event: string, response: unknown) => Promise<void>;
  configureBindings: (bindings: unknown[]) => Promise<void>;
  queueNudge: (nudge: Record<string, unknown>) => Promise<void>;
  getCallLog: () => Promise<Array<{ ts: string; path: string; body: unknown }>>;
}

function makeMockBackendControl(): MockBackendControl {
  const url = MOCK_BACKEND_URL;
  async function post(path: string, body: unknown) {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`mock-backend ${path} → ${res.status}`);
    return res.json();
  }
  return {
    url,
    reset: () => post("/__test__/reset", {}),
    configureDispatch: (event, response) =>
      post("/__test__/configure-dispatch", { event, response }),
    configureBindings: (bindings) =>
      post("/__test__/configure-bindings", { bindings }),
    queueNudge: (nudge) => post("/__test__/queue-nudge", nudge),
    getCallLog: async () => {
      const res = await fetch(`${url}/__test__/call-log`);
      return res.json();
    },
  };
}

/**
 * Opens code-server at /workspace, waits for workbench, dismisses any
 * walkthrough tabs that the extension auto-opened. Returns when the
 * workbench is ready for keystroke-based interaction (F1, etc.).
 */
export async function openWorkspace(page: Page): Promise<void> {
  await page.goto("/?folder=/workspace");

  // Root workbench — single instance, safe selector
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  // Statusbar present → workbench finished initial layout
  await expect(page.locator(".statusbar")).toBeVisible({ timeout: 30_000 });

  // Trust prompt: should NOT appear with our workspace .vscode/settings.json
  // (security.workspace.trust.enabled=false), but defend anyway.
  const trustButton = page.locator(
    'button:has-text("Yes, I trust"), button:has-text("Trust")',
  );
  if (await trustButton.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    await trustButton.first().click();
  }

  // Extension activates on onStartupFinished (async); give it room
  await page.waitForTimeout(3_000);

  // Close any walkthrough / Welcome tabs that auto-opened (AISHA Setup,
  // VS Code Welcome). These run as webview iframes that capture focus
  // and prevent keystrokes from reaching Monaco.
  await page.evaluate(() => {
    const closeBtns = Array.from(
      document.querySelectorAll(
        ".tabs-container .tab .tab-close .action-label, " +
          ".tabs-container .tab .codicon-close",
      ),
    );
    closeBtns.forEach((c) => (c as HTMLElement).click());
  });
  // Tab close is async (animations); wait
  await page.waitForTimeout(500);
}

/**
 * Verifies the AISHA Dirigent extension activated successfully by checking
 * its statusbar contribution. Throws if not found — useful as a fixture
 * post-condition.
 */
export async function expectExtensionActive(page: Page): Promise<void> {
  // 60s — first activation on a fresh container needs to load the bundled
  // 383 KB extension.js + run i18n bootstrap + initialize backend probe.
  // On warm container (cached) usually completes in <5s.
  await expect(page.locator(".statusbar")).toContainText(/Dirigent|AISHA/i, {
    timeout: 60_000,
  });
}

/**
 * Opens the command palette (F1 — Ctrl+P is swallowed by Chromium's print
 * dialog in headless mode) and runs the given command by typing its title.
 */
export async function runCommand(page: Page, commandTitle: string): Promise<void> {
  await page.keyboard.press("F1");
  await expect(page.locator(".quick-input-widget")).toBeVisible({ timeout: 5_000 });
  await page.keyboard.type(commandTitle);
  await page.waitForTimeout(300); // command palette filter debounce
  await page.keyboard.press("Enter");
}

interface E2EFixtures {
  mockBackend: MockBackendControl;
}

export const test = base.extend<E2EFixtures>({
  mockBackend: async ({}, use) => {
    const ctrl = makeMockBackendControl();
    await ctrl.reset();
    await use(ctrl);
    await ctrl.reset();
  },
});

export { expect };
