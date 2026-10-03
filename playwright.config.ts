/**
 * Playwright E2E Test Configuration — AISHA Platform
 *
 * Projects:
 * - setup: Authenticates all roles (admin, member, partner)
 * - chromium: Main test suite (desktop)
 * - mobile-chrome: Mobile viewport tests
 *
 * Run: npx playwright test
 * Run specific: npx playwright test e2e/admin-crud-operations.spec.ts
 * UI mode: npx playwright test --ui
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 2,
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/e2e-results.json" }],
    ["list"],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // No default storageState — each test must explicitly declare its auth role
        // via test.use({ storageState: "e2e/.auth/admin.json" }) or manual loginUser()
      },
      dependencies: ["setup"],
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        // No default storageState — tests must declare auth explicitly
      },
      dependencies: ["setup"],
      testMatch: /responsive|mobile/,
    },
  ],
  outputDir: "test-results/e2e",
  webServer: process.env.E2E_SKIP_SERVER
    ? undefined
    : {
        command: "npm run dev:e2e",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
