/**
 * Major verze platformního PostgreSQL pro skripty, které staví `infra/postgres`
 * (throwaway DB, obnova typů). Jeden domov: `POSTGRES_MAJOR` v config/image-versions.env;
 * proměnná prostředí má přednost, aby šlo změřit jinou verzi bez editace souboru
 * (`POSTGRES_MAJOR=18 npm run test:db`).
 *
 * Bez výchozí hodnoty: chybějící nebo nečíselná verze je STOP. Dosazená verze by
 * postavila jiný obraz, než jaký instance nasazuje, a měření by tiše ověřovalo
 * jiný svět.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @param {NodeJS.ProcessEnv} [env] @param {string} [root] @returns {string} např. "17" */
export function postgresMajor(env = process.env, root = ROOT) {
  let hodnota = env.POSTGRES_MAJOR;
  let zdroj = "POSTGRES_MAJOR v prostředí";
  if (!hodnota) {
    const soubor = path.join(root, "config/image-versions.env");
    const m = readFileSync(soubor, "utf8").match(/^POSTGRES_MAJOR=(.*)$/m);
    hodnota = m ? m[1].trim() : "";
    zdroj = soubor;
  }
  if (!/^[1-9][0-9]$/.test(hodnota)) {
    throw new Error(
      `POSTGRES_MAJOR='${hodnota}' (${zdroj}) není major verze PostgreSQL — ` +
        `čekám dvouciferné číslo, např. 17. Domov je config/image-versions.env.`,
    );
  }
  return hodnota;
}

/** Build-arg pro `docker build … infra/postgres`. */
export function postgresMajorBuildArgs(env = process.env, root = ROOT) {
  return ["--build-arg", `PG_MAJOR=${postgresMajor(env, root)}`];
}
