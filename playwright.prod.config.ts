/**
 * Playwright Config — Production E2E
 *
 * Separate config from `playwright.config.ts`. Differences:
 *  - No `setup` project dependency (test users aren't seeded on production KC)
 *  - Tests must self-authenticate via env-provided credentials, OR run as
 *    anonymous (use storageState: { cookies: [], origins: [] })
 *  - No webServer: targets a deployed platform (E2E_BASE_URL must be set)
 *  - Lower retry count: prod is generally more stable than dev
 *
 * Run:
 *   E2E_BASE_URL="${VITE_PUBLIC_SITE_URL}" npx playwright test \
 *     --config=playwright.prod.config.ts \
 *     e2e/prod-oidc-flow.spec.ts \
 *     e2e/public-smoke.generated.spec.ts
 *
 * Or via container:
 *   bash scripts/e2e/run-against-production.sh
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL;
if (!BASE_URL) {
  throw new Error("E2E_BASE_URL is required for production Playwright runs.");
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true, // prod targets are robust enough for parallel
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,
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
    // Anonymous by default — tests can override via test.use({ storageState })
    storageState: { cookies: [], origins: [] },
  },
  projects: [
    {
      // Production-specific auth setup — UI-based login (not ROPC).
      // Uses E2E_*_EMAIL/PASSWORD env vars; skips roles whose creds aren't
      // provided. Persists each role's storage state to e2e/.auth/<role>.json.
      // Activate by adding `dependencies: ["setup"]` to test projects below
      // OR by running --project=setup explicitly first.
      name: "setup",
      testMatch: /auth-prod\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
      // No mandatory setup dependency for the bulk of anonymous tests.
      // Auth-required tests opt-in via test.use({ storageState: ... }).
    },
    {
      name: "chromium-authed",
      use: {
        ...devices["Desktop Chrome"],
      },
      // Auth-required tests run on this project — depends on setup so
      // storage state files are populated before tests start.
      dependencies: ["setup"],
      testMatch: /(admin|member|partner|backend|ai-features|mcp-admin)\b/,
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
      },
      testMatch: /responsive|mobile/,
    },
  ],
  outputDir: "test-results/e2e",
  // No webServer — production is the target
});
