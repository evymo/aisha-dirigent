import { defineConfig } from 'vitest/config';

// Backend service: stejný důvod jako u svc-source-broker — zastavit vitest, aby
// nešel nahoru ke kořenovému postcss.config.js frontendu.
//
// `config.ts` volá `requireEnv` už při importu (fail-closed konfigurace), takže
// test musí vstupy DEKLAROVAT — hodnoty jsou `.invalid`, aby se na ně nešlo
// omylem připojit. Týž vzor jako `svc-source-broker/vitest.config.ts`.
export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      KEYCLOAK_REALM: 'testrealm',
      KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
    },
  },
});
