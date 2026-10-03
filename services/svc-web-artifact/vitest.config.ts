import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "src/tests/**/*.unit.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 15_000,
    // ⛔ NAMĚŘENO 2026-08-19. `config.ts` přestal adresu gatewaye HÁDAT
    // (dřív `?? 'http://gateway:3001'` — obecné jméno bez prefixu instance,
    // které na sdíleném hostiteli trefí cizí instanci, nebo nic). Testy si ji
    // proto musí DEKLAROVAT, tak jako ji v provozu deklaruje compose.
    //
    // Jméno je schválně `test-…`, aby se nedalo splést s provozní adresou —
    // testy sem nesmějí propašovat hodnotu, která někde doopravdy existuje.
    //
    // ⚠️ Předpushová bariéra tenhle balík PŘESKAKUJE (AISHA_SMOKE_SKIP_SERVICES=1),
    // takže se tenhle pád objeví až v CI úloze `Services: Tests`.
    env: {
      AISHA_GATEWAY_URL: "http://test-gateway.invalid:3001",
    },
  },
});
