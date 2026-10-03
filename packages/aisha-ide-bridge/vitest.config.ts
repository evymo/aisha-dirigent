import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/__tests__/**/*.unit.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 10_000,
  },
});
