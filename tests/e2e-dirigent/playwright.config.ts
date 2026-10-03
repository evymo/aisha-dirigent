/**
 * Playwright config for e2e-dirigent VS Code surface (via code-server).
 *
 * Targets http://code-server:8443 inside docker-compose, or
 * http://127.0.0.1:8443 when developer runs locally.
 *
 * Independent of repo root playwright.config.ts (which targets the web app).
 */

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.CODE_SERVER_URL ?? "http://127.0.0.1:8443";

export default defineConfig({
  testDir: "./playwright/specs",
  timeout: 90_000, // VS Code load + extension activation is heavy
  expect: { timeout: 15_000 },
  fullyParallel: false, // shared code-server instance — serialize
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../playwright-report-e2e-dirigent", open: "never" }],
    ["json", { outputFile: "../../test-results/e2e-dirigent-vscode.json" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    // code-server with --auth none — no storage state needed
  },
  projects: [
    {
      name: "code-server-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
