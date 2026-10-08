/**
 * Výchozí OBRAZ zahazovací DB — jeden domov pro with-throwaway-db.mjs
 * i types-refresh-throwaway.mjs (vedle throwaway-db-tajemstvi.mjs).
 *
 * Tag nese major verzi postgresu a OTISK OBSAHU build kontextu (infra/postgres):
 * `aisha-db-throwaway:pg<major>-<sha256[:12]>`.
 *  - Major verze: obraz 17 z cache se nesmí vzít, když se měří 18.
 *  - Otisk: obraz starého entrypointu nebo initdb skriptu se nesmí vzít, když se měří
 *    nový. Otisk bere PRACOVNÍ soubory, ne git strom, aby platil i pro necommitnuté úpravy.
 *
 * ⛔ PROČ JEDEN DOMOV: 2026-09-25 se testovací DB přepnula na otisk (klíče šifrování
 * se přestěhovaly z GUC do souborů, které zapisuje entrypoint), typegen ale zůstal na
 * PROMĚNLIVÉM tagu `aisha-db-throwaway:pg<major>`. Ten sdílí každý worktree a každá
 * relace na stroji: kdo obraz přestavěl ze SVÉHO stromu, změnil, co spouští typegen
 * všech ostatních (naměřeno 2026-10-02 ve dvou worktree — „DB did not become ready“,
 * v logu cizí entrypoint). Hlídá throwaway-db-obraz.test.mjs.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Otisk obsahu `<root>/infra/postgres` (cesty i obsah, seřazeno) — 12 hex znaků.
 *
 * @param {string} root kořen repa
 * @returns {string}
 */
export function otiskKontextuDb(root) {
  const koren = path.join(root, "infra/postgres");
  const h = createHash("sha256");
  const projdi = (dir) => {
    for (const jmeno of readdirSync(dir).sort()) {
      const abs = path.join(dir, jmeno);
      if (statSync(abs).isDirectory()) projdi(abs);
      else h.update(path.relative(koren, abs)).update("\0").update(readFileSync(abs)).update("\0");
    }
  };
  projdi(koren);
  return h.digest("hex").slice(0, 12);
}

/**
 * Výchozí tag obrazu zahazovací DB pro daný strom a major verzi.
 *
 * @param {string} root kořen repa
 * @param {string|number} pgMajor major verze postgresu (POSTGRES_MAJOR)
 * @returns {string}
 */
export function vychoziObrazDb(root, pgMajor) {
  return `aisha-db-throwaway:pg${pgMajor}-${otiskKontextuDb(root)}`;
}
