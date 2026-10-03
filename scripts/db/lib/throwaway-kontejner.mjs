/**
 * Jméno kontejneru jednorázové DB a úklid po PŘERUŠENÝCH bězích.
 *
 * ⛔ NAMĚŘENO 2026-09-30: `db:types:refresh:throwaway` pojmenovával kontejner PEVNĚ
 *    (`aisha-typegen-throwaway`) a každý běh začínal `docker rm -f` toho jména. Dvě
 *    relace nad týmž strojem si tak navzájem mazaly databázi uprostřed běhu —
 *    zkrácené typy, „server closed the connection“ uprostřed baseline, „connection
 *    refused“. `with-throwaway-db.mjs` to už řeší jménem za běh (pid + náhoda); tady
 *    je totéž pravidlo jednou, aby ho mohl vzít každý throwaway skript.
 *
 * Úklid smí sáhnout JEN na kontejnery, jejichž proces (pid ve jméně) už neběží —
 * živý běh jiné relace se nechává být, právě jeho smazání byl nález. Opakované
 * pid (recyklace) se vyhodnotí jako živé: kontejner zůstane, nic se nerozbije.
 *
 * @module
 */
import { randomBytes } from "node:crypto";

/**
 * Jméno kontejneru pro TENTO běh: `<prefix>-<pid>-<6 hex>`.
 * Výslovné jméno (`override`, typicky z proměnné prostředí) má přednost — ladění,
 * ruční úklid; prázdný řetězec se jako výslovné jméno nebere.
 *
 * @param {string} prefix
 * @param {{ override?: string | undefined, pid?: number, nahoda?: () => string }} [volby]
 * @returns {string}
 */
export function jmenoKontejneru(prefix, { override, pid = process.pid, nahoda = () => randomBytes(3).toString("hex") } = {}) {
  const vyslovne = typeof override === "string" ? override.trim() : "";
  return vyslovne || `${prefix}-${pid}-${nahoda()}`;
}

/**
 * Kontejnery po přerušených bězích: jméno ve tvaru `<prefix>-<pid>-<6 hex>`
 * a proces s tím pid už neběží. Cizí jména (i starý pevný `prefix` bez pid)
 * se nevrací nikdy — nevíme, komu patří.
 *
 * @param {readonly string[]} jmena  jména z `docker ps -a`
 * @param {string} prefix
 * @param {(pid: number) => boolean} zije
 * @returns {string[]}
 */
export function mrtveKontejnery(jmena, prefix, zije) {
  const vzor = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)-[0-9a-f]{6}$`);
  return jmena.filter((jmeno) => {
    const m = vzor.exec(jmeno);
    return m !== null && !zije(Number(m[1]));
  });
}

/**
 * Běží proces s tímhle pid? Signál 0 se jen ptá. EPERM = proces běží, jen patří
 * jinému uživateli — pro úklid je to „živý“.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function procesZije(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e)?.code === "EPERM";
  }
}
