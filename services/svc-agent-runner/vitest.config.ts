import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      KEYCLOAK_REALM: 'testrealm',
      KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
      POSTGREST_URL: 'http://test-postgrest.invalid:3000',
      // Broker-proxy je povinná (config.ts requireEnv) — testy, které čtou skutečný config.
      BROKER_PROXY_ALIAS: 'test-plugin-broker',
    },
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "src/tests/**/*.unit.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 15_000,
  },
});
