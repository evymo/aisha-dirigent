import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Backend služba: bez tohohle vitest doleze k postcss configu forku
  // (tailwind/autoprefixer), který sem nepatří a padá, když nejsou
  // nainstalované frontendové devDependencies. Týž důvod jako
  // v services/svc-source-broker/vitest.config.ts.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
