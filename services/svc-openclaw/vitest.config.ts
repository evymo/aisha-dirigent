import { defineConfig } from 'vitest/config';

// Service-scoped vitest config: do NOT inherit the root setup file
// (src/test/setup.ts exists only in the platform repo root, not here).
// Pure-unit tests in svc-openclaw need no DOM / fetch polyfill / etc.
export default defineConfig({
  test: {
    env: {
      POSTGREST_URL: 'http://test-postgrest.invalid:3000',
    },
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: [],
  },
});
