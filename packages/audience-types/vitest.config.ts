import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Standalone package config — without this, `vitest run` walks up to the
  // fork-root Vue config (frontend postcss + a `src/test/setup.ts` setupFile
  // that only exists for the frontend), which fails here. Mirrors
  // services/svc-source-broker/vitest.config.ts.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
