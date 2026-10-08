import { defineConfig } from 'vitest/config';

/**
 * Vlastní konfigurace, ne zděděná z kořene.
 *
 * Kořenová konfigurace nese `setupFiles` pro aplikaci (DOM, mocky prohlížeče).
 * Balíček, který si ji zdědí, na nich spadne dřív, než se dostane k prvnímu
 * testu — a pád v setupu vypadá jako rozbitý balíček, ne jako špatná konfigurace.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
  },
});
