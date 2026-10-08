/**
 * Vitest configuration for the AISHA Omni acceptance suite.
 *
 * Acceptance tests verify the contract in docs/planning/AISHA_OMNI_GATEWAY.md
 * (v4, §0–§20). They are deliberately ISOLATED from the normal CI run:
 *   - the default vitest.config.ts EXCLUDES src/tests/omni-acceptance/**,
 *   - this config is the ONLY entry point that runs them,
 *   - some live tests are intentionally RED — they prove current bugs and act
 *     as regression guards (see the live-vs-skip comments in each spec).
 *
 * Mirrors vitest.gates.config.ts (node env, longer timeouts, no jsdom).
 *
 * Usage:
 *   OMNI_ACCEPTANCE=1 npx vitest run --config vitest.omni-acceptance.config.ts
 *   npx vitest run --config vitest.omni-acceptance.config.ts src/tests/omni-acceptance/quota-admission/
 *
 * @module
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/tests/omni-acceptance/**/*.omni.spec.ts"],
    // Každý soubor dostane vlastní dočasný adresář a po sobě ho smaže.
    setupFiles: [path.resolve(__dirname, "./src/test/docasny-adresar-souboru.ts")],
    globalSetup: [path.resolve(__dirname, "./src/test/docasny-adresar-behu.ts")],
    // _helpers / _fixtures hold shared scaffold, not test files — never matched
    // by the glob above (no .omni.spec.ts suffix), but excluded for clarity.
    exclude: [
      "src/tests/omni-acceptance/_helpers/**",
      "src/tests/omni-acceptance/_fixtures/**",
    ],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    maxWorkers: process.env.VITEST_MAX_WORKERS ? Number(process.env.VITEST_MAX_WORKERS) : 4,
    minWorkers: process.env.VITEST_MAX_WORKERS ? Math.min(2, Number(process.env.VITEST_MAX_WORKERS)) : 1,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@aisha/api-core": path.resolve(__dirname, "./packages/api-core/src/index.ts"),
    },
  },
});
