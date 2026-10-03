/**
 * postgrest-vstup-testu.mjs — adresa PostgRESTu pro vitest služby: unit lane ji
 * DEKLARUJE nerozřešitelnou, integrační lane ji NESMÍ přebít.
 *
 * ⛔ NAMĚŘENO 2026-09-13: `npm run test:integration:rag-eval` padal
 * `ENOTFOUND test-postgrest.invalid`, i když scripts/db/with-throwaway-postgrest.mjs
 * PostgREST spustil a `POSTGREST_URL` exportoval. Příčina je v konfiguraci, ne v harnessu:
 * `test.env` ve vitest.config.ts služby přiřazuje hodnoty BEZPODMÍNEČNĚ — vitest 3.2.6,
 * dist/chunks/setup-common.*.js `setupEnv`: `for (const key in restEnvs) process.env[key] = env[key]`.
 * Literál `http://test-postgrest.invalid:3000` (commit 89d28a333: `config.ts` od 2026-08-24
 * POSTGREST_URL vyžaduje, takže unit testy bez něj nešly importovat) tak přepsal adresu,
 * kterou harness dodal. Totéž platí pro svc-ai-chat lane `test:reflection:fullenv`
 * a `test:flowboard:*` — jejich testy čtou `process.env.POSTGREST_URL` po přepisu.
 *
 * Proč ne `process.env.POSTGREST_URL ?? '…invalid'`: to je tichý fallback (a račna
 * env-fallback.baseline by ho počítala). Unit lane nemá mít síť ani tehdy, když má
 * vývojář v shellu exportovanou skutečnou adresu — `.invalid` (RFC 6761) z definice
 * nerezolvuje, takže unikající volání selže hned a stejně na každém stroji.
 *
 * Integrační lane se DEKLARUJE: harness with-throwaway-postgrest.mjs exportuje
 * `AISHA_TEST_LANE=integration` spolu s adresou. V deklarované lane se POSTGREST_URL
 * do `test.env` nevkládá (hodnota harnessu zůstane) a když chybí, je to rozbitý harness —
 * chyba při načtení konfigurace, ne tichý přechod na `.invalid`.
 */

/** Adresa, která z definice nerezolvuje (RFC 6761 `.invalid`) — unit lane nemá síť. */
export const NEROZRESITELNY_POSTGREST = "http://test-postgrest.invalid:3000";

/**
 * Položky `test.env` pro POSTGREST_URL podle DEKLAROVANÉ lane.
 * @param {Record<string, string | undefined>} env prostředí procesu, který načítá konfiguraci
 * @returns {Record<string, string>} co vložit do `test.env` (v integrační lane nic)
 */
export function postgrestVstupTestu(env) {
  const lane = env.AISHA_TEST_LANE;
  if (lane === undefined || lane === "") return { POSTGREST_URL: NEROZRESITELNY_POSTGREST };
  if (lane !== "integration") {
    throw new Error(`AISHA_TEST_LANE='${lane}' neznám — deklarované hodnoty: integration (nebo nenastaveno = unit)`);
  }
  if (!env.POSTGREST_URL) {
    throw new Error(
      "AISHA_TEST_LANE=integration, ale POSTGREST_URL chybí — harness (scripts/db/with-throwaway-postgrest.mjs) " +
        "adresu nedodal; unit adresu .invalid sem dosazovat nebudu",
    );
  }
  return {};
}
