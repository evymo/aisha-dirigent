import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// Local-workspace aliases for @aisha/* packages. In the Docker image npm
// resolves them from Verdaccio (https://npm.id3a.cz). For local vitest
// runs we point at the source TS in packages/* so we don't need a
// publish round-trip to run unit tests. (Phase 13 WP 13.4.)
const aishaPackageAliases = {
  "@aisha/cache-redis/client": resolve(repoRoot, "packages/cache-redis/src/client.ts"),
  "@aisha/cache-redis": resolve(repoRoot, "packages/cache-redis/src/index.ts"),
};

export default defineConfig({
  resolve: {
    alias: aishaPackageAliases,
  },
  test: {
    env: {
      KEYCLOAK_REALM: 'testrealm',
      KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
    },
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.{test,spec,unit.test}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
    },
  },
});
