import { defineConfig } from "vitest/config";

// Self-contained service test config (mirrors the other services/* configs).
// Without this, `vitest run` climbs to the repo-root config, whose
// setupFiles=./src/test/setup.ts then resolves against this service's cwd and
// fails. Storage-auth was the only service missing its own config.
export default defineConfig({
  test: {
    env: {
      KEYCLOAK_REALM: 'testrealm',
      KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
      POSTGREST_URL: 'http://test-postgrest.invalid:3000',
    },
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // *.it.test.ts are integration tests (REAL clamd + MinIO) run only by
    // scripts/test/run-av-integration.mjs via vitest.it.config.ts — exclude them here so the
    // default unit run never collects them (they import the minio client, absent without the harness).
    exclude: ["dist/**", "node_modules/**", "**/*.it.test.ts"],
    testTimeout: 15_000,
  },
});
