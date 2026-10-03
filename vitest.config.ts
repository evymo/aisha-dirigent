import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    minWorkers: 1,
    // CI on the memory-limited self-hosted runner sets VITEST_MAX_WORKERS=1
    // and shards test:run (see ci.yml "Web: Tests"):
    // the default 2 jsdom workers peak at ~2 GB and OOM-kill mid-suite (#279).
    // Local dev keeps 2 (faster). See .forgejo/workflows/ci.yml "Web: Tests".
    maxWorkers: process.env.VITEST_MAX_WORKERS ? Number(process.env.VITEST_MAX_WORKERS) : 2,
    hookTimeout: 30000,
    testTimeout: 180000,
    // Absolutně přes __dirname, ne relativně: relativní cesta se skládá proti
    // workspace rootu, který si vite hledá směrem NAHORU. Když checkout leží
    // uvnitř jiného repa (git worktree založený jako podadresář), root vyjde
    // o úroveň výš a setup se hledá v cizím stromě — celá sada pak padá na
    // „Cannot find module …/src/test/setup.ts". Aliasy níž už __dirname
    // používají; tohle byla jediná relativní cesta v konfiguraci.
    setupFiles: [path.resolve(__dirname, "./src/test/setup.ts")],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "src/tests/gates/**/*.gate.test.ts",
      // Omni acceptance suite is ISOLATED from normal CI — runs only via
      // vitest.omni-acceptance.config.ts. Several specs are intentionally RED
      // (regression guards proving current bugs) and must never break CI.
      "src/tests/omni-acceptance/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "src/tests/**",
        "src/**/*.d.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@aisha/api-core": path.resolve(__dirname, "./packages/api-core/src/index.ts"),
      "@aisha/flowboard-core": path.resolve(__dirname, "./packages/flowboard-core/src/index.ts"),
      "@aisha/capture-ui": path.resolve(__dirname, "./packages/capture-ui/src/index.ts"),
      vscode: path.resolve(__dirname, "./src/test/__mocks__/vscode.ts"),
    },
  },
});
