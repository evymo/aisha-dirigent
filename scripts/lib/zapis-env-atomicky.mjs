/**
 * zapis-env-atomicky.mjs — atomická náhrada obsahu souboru, která PŘEŽIJE SYMLINK.
 *
 * ⛔ NAMĚŘENO 2026-09-15. `aisha-redeploy.mjs` zapisoval `.env.coolify` jako
 * `<cesta>.tmp-*` + `renameSync(tmp, cesta)`. V git worktree je `.env.coolify`
 * často symlink na hlavní trezor — a `rename` na cestu symlinku ho NAHRADÍ
 * regulárním souborem. Zápis skončil v kopii, hlavní trezor zůstal bez
 * MESH_PEER_IPS a s 4 položkami GATEWAY_TRUSTED_PROXIES místo 25.
 *
 * Proto: cíl se rozliší `realpathSync` a dočasný soubor vzniká VEDLE něj.
 * Rename zůstává atomický (týž adresář = týž souborový systém) a symlink
 * přežije. Shellová dvojice je `scripts/lib/env-zapis.sh`.
 */
import { existsSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";

let _poradi = 0;

/**
 * @param {string} cesta   soubor nebo symlink na něj
 * @param {string} obsah
 * @param {{ mode?: number }} [opts]  práva nového souboru (trezor: 0o600)
 * @returns {string} skutečná cesta, do které se zapsalo
 */
export function nahradObsahAtomicky(cesta, obsah, { mode } = {}) {
  const cil = existsSync(cesta) ? realpathSync(cesta) : cesta;
  const docasny = `${cil}.tmp-${process.pid}-${++_poradi}`;
  try {
    writeFileSync(docasny, obsah, mode === undefined ? undefined : { mode });
    renameSync(docasny, cil);
  } catch (e) {
    rmSync(docasny, { force: true });
    throw e;
  }
  return cil;
}
