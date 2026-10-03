import { defineConfig } from "vitest/config";
// `test.env` přebíjí prostředí bezpodmínečně — adresu PostgRESTu dodanou integračním
// harnessem proto rozhoduje deklarovaná lane, ne literál (proč: hlavička modulu).
import { postgrestVstupTestu } from "../../scripts/test/postgrest-vstup-testu.mjs";

export default defineConfig({
  test: {
    env: {
      KEYCLOAK_REALM: 'testrealm',
      KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
      ...postgrestVstupTestu(process.env),
    },
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "src/tests/**/*.unit.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 15_000,
  },
});
