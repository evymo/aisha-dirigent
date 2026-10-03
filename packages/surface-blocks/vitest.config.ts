import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Own config so the package does not inherit the fork-root setupFiles, which
  // pull in a DB/test harness this pure-schema package has no use for (and which
  // crashes when its env is absent).
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
