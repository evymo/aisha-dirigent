/**
 * E2E Test: Setup Wizard & AI Agent Local Stack Deployment
 *
 * Verifies the delegation flow for "Local" mode in the new workbench-style
 * SetupPanel (workbench setup + aisha-dirigent for VSCode-like IDEs):
 *
 * - When local scan finds no backend, the wizard offers a "Deploy Local Stack"
 *   action that delegates the actual docker-compose / local stack install
 *   to the @aisha /dirigent agent (via workbench.action.chat.open).
 * - The wizard then polls and auto-advances once the backend becomes available.
 *
 * The test uses the e2e-dirigent harness (code-server + mock-backend as the
 * "plnohodnotná lokální verze stacku"). No real long-lived Docker stack is
 * required for the wizard E2E.
 *
 * See plan in user query (SetupPanel.ts changes + this test).
 */

import { test, expect, openWorkspace, runCommand } from "../fixtures/code-server.js";

test.describe("Setup Wizard — Local mode delegation to Aisha Agent", () => {
  test("opens wizard, selects Local, shows deploy CTA when no backend, and starts delegated local stack flow", async ({
    page,
    mockBackend,
  }) => {
    // Ensure clean state — no "backend" services responding for the initial scan
    await mockBackend.reset();

    await openWorkspace(page);
    await runCommand(page, "AISHA Dirigent: Connect (Setup Wizard)");

    const setup = page.frameLocator("iframe.webview").first();
    await expect(setup.locator("text=AISHA Workbench")).toBeVisible({ timeout: 15_000 });

    // Select local mode card.
    const localCard = setup.locator('[data-mode="local"]').first();
    await localCard.click();

    // Wait for scan to finish and scan-results / scan step to render
    await expect(setup.locator("#step-scan")).toBeVisible({ timeout: 15_000 });

    // Because no local AISHA gateway is running in the e2e fixture, the
    // delegated local-stack CTA should be visible.
    const deployBtn = setup.locator('[data-testid="deploy-local-stack"]').first();
    await expect(deployBtn).toBeVisible({ timeout: 8_000 });

    // Click the deploy button. The extension delegates the actual work to
    // workbench.action.chat.open and surfaces status in the wizard.
    await deployBtn.click();
    await expect(setup.locator("#deploy-status")).toContainText(/Dirigent|wizard/i, {
      timeout: 5_000,
    });
  });
});
