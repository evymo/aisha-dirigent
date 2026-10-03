/**
 * Discovery mesh peerů v JEDNOM běhu redeploye — jeden souběžný dotaz, úspěch
 * i odmítnuté pověření se pamatují.
 *
 * ⛔ NAMĚŘENO 2026-09-17 (cold-start instance, vlna 6): Keycloak zalogoval během
 * ~1 s ŠEST `LOGIN_ERROR clientId="aisha-bootstrap" error="user_temporarily_disabled"`
 * (executor-thread-5…10). Příčina v kódu:
 *   - vlna spouští appky souběžně (`Promise.all` v aisha-redeploy.mjs) a každá
 *     volá `refreshMeshIps` → vlastní proces netbird-peer-discover.mjs,
 *   - každý proces udělá JEDEN ROPC pokus (`grant_type=password`) za uživatele
 *     aisha-bootstrap,
 *   - pamatoval se JEN úspěch, takže po neúspěchu poslala KAŽDÁ vlna N
 *     souběžných pokusů znovu.
 * Realm má brute-force ochranu (failureFactor 5, quickLoginCheck 1000 ms), takže
 * pár neúspěchů — a souběžné pokusy v téže sekundě — uživatele zamkne a každý
 * další pokus zámek jen prodlužuje. Zamčený uživatel pak vrací 401 i se správným
 * heslem, mesh refresh nezapíše MESH_PEER_IPS a fáze D (netbird-bootstrap) by
 * narazila na tentýž zámek.
 *
 * Pravidla:
 *   1. SOUBĚŽNÍ volající sdílí jeden běžící dotaz (single-flight).
 *   2. Úspěch platí do konce běhu (jako dřív).
 *   3. Keycloak ODMÍTL pověření (HTTP 401 na token) → do konce běhu se ROPC
 *      nezkouší; volající dostane srozumitelnou chybu místo dalšího pokusu.
 *   4. Jiný neúspěch (mesh/NetBird ještě nestojí, síť) se v DALŠÍM volání
 *      zkusí znovu — neúspěch ve vlně 3 nesmí vzít pokus ve vlně 6.
 */

const ODMITNUTE_POVERENI = /Keycloak bootstrap token request failed: HTTP 401/;

/** Je chyba potomka odmítnutím pověření Keycloakem? (stderr i message — execFile dává obojí) */
export function jeOdmitnutePovereni(chyba) {
  return ODMITNUTE_POVERENI.test(`${chyba?.stderr ?? ""}\n${chyba?.message ?? ""}`);
}

export function vytvorDiscoveryVBehu() {
  let uspech = null;
  let odmitnuto = null;
  let probiha = null;

  /**
   * @param {() => Promise<{stdout: string}>} spust — spustí discovery (jen když je potřeba)
   * @returns {Promise<{stdout: string, zPameti: boolean}>}
   */
  return async function discovery(spust) {
    if (uspech) return { ...uspech, zPameti: true };
    if (odmitnuto) throw odmitnuto;
    if (!probiha) {
      probiha = (async () => {
        try {
          const vysledek = await spust();
          uspech = { stdout: vysledek.stdout };
          return { stdout: vysledek.stdout, zPameti: false };
        } catch (e) {
          if (jeOdmitnutePovereni(e)) {
            const puvod = String(e?.stderr || e?.message || "").trim().split("\n").filter(Boolean).slice(0, 2).join(" | ");
            odmitnuto = Object.assign(
              new Error(
                "Keycloak odmítl pověření uživatele aisha-bootstrap (HTTP 401 invalid_grant). " +
                  "Buď neplatí heslo, nebo je uživatel zamčený brute-force ochranou realmu " +
                  "(v logu Keycloaku `user_temporarily_disabled`) — Keycloak v obou případech " +
                  "odpovídá stejně a KAŽDÝ další pokus zámek prodlužuje. Discovery se proto do konce " +
                  "tohoto běhu NEZKOUŠÍ. CO S TÍM: ověř otisk AISHA_BOOTSTRAP_PASSWORD proti Keycloaku " +
                  "(realm-sync ho nastaví při nasazení aisha-keycloak) a zámek nech vypršet " +
                  `(maxFailureWaitSeconds realmu). Původ: ${puvod}`,
              ),
              { stderr: e?.stderr, odmitnutePovereni: true },
            );
            throw odmitnuto;
          }
          throw e;
        } finally {
          probiha = null;
        }
      })();
    }
    return probiha;
  };
}
