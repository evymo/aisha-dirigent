import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Parser cronu počítá v pásmu procesu; testy se tím nezávisí na stroji.
      TZ: 'UTC',
      KEYCLOAK_REALM: 'testrealm',
      KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
      POSTGREST_URL: 'http://test-postgrest.invalid:3000',
    },
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "src/tests/**/*.unit.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 15_000,
  },
});
