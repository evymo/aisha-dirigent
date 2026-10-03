import { defineConfig } from 'vitest/config';

// Self-contained config (mirrors packages/security, packages/aitg, …). Without
// it the package inherits the root vitest.config.ts, whose setupFiles
// (./src/test/setup.ts) resolve relative to this package cwd and do not exist.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    reporters: ['default'],
  },
});
