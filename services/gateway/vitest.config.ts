import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // ⛔ NAMĚŘENO 2026-08-19. `config.ts` přestal adresy vnitřních služeb HÁDAT
    // (dřív `?? 'http://postgrest:3000'` a `?? 'http://keycloak:8080'` — OBECNÁ
    // jména bez prefixu instance; na sdíleném hostiteli trefí cizí instanci,
    // nebo nic). V provozu je deklaruje compose (`${APP_NAME_PREFIX:?}-postgrest`,
    // `${KEYCLOAK_INTERNAL_URL:?}`), tady si je musí deklarovat testy.
    //
    // Jména jsou schválně `.invalid` (RFC 2606), aby se nedala splést s provozní
    // adresou a aby případný skutečný odchozí požadavek selhal hlasitě.
    //
    // ⚠️ Dřív tu stálo, že předpushová bariéra tenhle balík PŘESKAKUJE
    // (AISHA_SMOKE_SKIP_SERVICES=1). NAMĚŘENO 2026-09-05: neplatí — `.husky/pre-push`
    // pouští `npm run test:services` (~100 s) a dva pushe na něm padly. Pád se
    // tedy objeví UŽ před pushem, ne až v CI úloze `Services: Tests`.
    //
    // Časový strop testů je výchozí (5 000 ms). Soubor, který si per test znovu
    // natahuje Fastify (`routes/pats.test.ts`), si ho zvedá sám s naměřeným
    // odůvodněním — globálně ho nezvedáme, aby pomalý test nebyl neviditelný.
    env: {
      POSTGREST_URL: 'http://test-postgrest.invalid:3000',
      KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
      MATRIX_SERVICE_URL: 'http://test-svc-matrix.invalid:3000',
          AI_CHAT_SERVICE_URL: 'http://test-ai-chat-service.invalid:3011',
      KEYCLOAK_REALM: 'testrealm',
      // Komu brána věří. V provozu to skládá env-doctor z deklarovaných OIDC
      // klientů; test si deklaruje vlastní, protože chybějící hodnota bránu
      // ZÁMĚRNĚ shodí (`requireEnv`) — hádat, kdo se smí ověřovat, nesmí.
      KC_ALLOWED_CLIENTS: 'testclient-app,testclient-device',
},
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
