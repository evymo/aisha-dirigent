import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Bez tohohle doleze vitest k postcss configu forku (tailwind/autoprefixer),
  // který sem nepatří. Týž důvod jako v services/svc-source-broker.
  css: { postcss: { plugins: [] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
