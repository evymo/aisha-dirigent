/**
 * Kterým klientům PLATFORMNÍHO realmu se věří jako nositelům identity člověka —
 * pravidlo, ze kterého vzniká `KC_ALLOWED_CLIENTS`. JEDEN domov:
 *
 *   - `scripts/aisha-env-doctor.mjs` (`kcAllowedClients`) jím skládá hodnotu pro nasazení
 *     a přidává k němu klienty instančního overlaye;
 *   - `config/local-presets.mjs` jím skládá hodnotu pro místní stack (ten overlay nemá).
 *
 * Hodnotu pak dostává gateway (výměna tokenu za PostgREST JWT) i svc-mcp-knowledge (`/mcp`).
 *
 * ⛔ NAMĚŘENO 2026-10-04: pravidlo žilo jen uvnitř env-doktora, takže ho nikdo jiný nemohl
 * použít — místní presety a výchozí hodnota ve službě svc-mcp-knowledge nesly RUČNÍ výčet.
 * Nový veřejný klient realmu (`aisha-mcp-client`) by se do nich nedostal a přihlášení by
 * končilo 403 bez souvislosti s příčinou.
 *
 * Pravidlo: `publicClient: true` a jméno nezačíná `account` (vestavění klienti Keycloaku).
 * Důvěrní klienti a servisní účty sem nepatří — token má nést identitu člověka, ne stroje.
 *
 * Čistá funkce: nečte prostředí, soubory ani overlay.
 *
 * @module
 */

/**
 * @param {unknown} realm  Rozparsovaný `keycloak/aisha-realm.json`.
 * @returns {string[]}     Jména klientů, seřazená (pořadí nezávislé na locale).
 */
export function verejniKlientiRealmu(realm) {
  const klienti = realm && typeof realm === "object" && Array.isArray(realm.clients) ? realm.clients : [];
  const out = new Set();
  for (const c of klienti) {
    if (c?.clientId && c.publicClient === true && !String(c.clientId).startsWith("account")) {
      out.add(c.clientId);
    }
  }
  return [...out].sort();
}
