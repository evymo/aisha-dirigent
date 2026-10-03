import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Backend service: stop vitest from walking up to the fork-root Vue
  // postcss.config.js (tailwindcss/autoprefixer), which is irrelevant here and
  // breaks when the frontend devDependencies aren't installed. An inline empty
  // PostCSS config disables the external-config search.
  css: { postcss: { plugins: [] } },
  test: {
    env: {
      KEYCLOAK_REALM: 'testrealm',
      KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
      POSTGREST_URL: 'http://test-postgrest.invalid:3000',
    },
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
