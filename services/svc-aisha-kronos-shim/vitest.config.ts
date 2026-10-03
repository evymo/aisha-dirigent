import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      POSTGREST_URL: 'http://test-postgrest.invalid:3000',
    },
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "src/tests/**/*.unit.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 15_000,
  },
});
