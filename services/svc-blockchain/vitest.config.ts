import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      KEYCLOAK_REALM: 'testrealm',
      KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
    },
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "src/tests/**/*.unit.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 15_000,
  },
});
