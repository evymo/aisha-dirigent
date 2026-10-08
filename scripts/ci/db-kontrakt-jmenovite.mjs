#!/usr/bin/env node
/**
 * db-kontrakt-jmenovite.mjs — jmenované DB sady v JEDNÉ throwaway DB
 *
 * Lane „Kontrakt bloků a nároky definer funkcí“ pouští vybrané skripty
 * `test:db:<jméno>`. Každý z nich si staví vlastní throwaway DB (kontejner,
 * baseline, heals, seed ~60 s), takže lane je pouští v jedné DB za sebou.
 *
 * Seznam SOUBORŮ přitom nesmí žít podruhé ve workflow. Naměřeno 2026-09-30:
 * opsaný seznam v ci.yml se za den rozjel s package.json — přibyl
 * `test:db:app-secrets` (2 soubory) a `test:db:pohledavka` narostl z 1 na
 * 3 soubory. CI by nové soubory tiše nepouštělo a zelená by znamenala
 * „neměřeno“. Workflow proto předává JMÉNA (stejná jako dřívější jmenovité
 * kroky) a soubory se čtou z jediného zdroje — package.json.
 *
 * Skript, jehož tvar neznám, je chyba, ne odhad: kdyby `test:db:<jméno>`
 * přidal přepínač nebo jiný příkaz, sloučení do jednoho běhu by ho tiše změnilo.
 *
 * Použití:
 *   node scripts/ci/db-kontrakt-jmenovite.mjs <jméno>...          spustí v jedné DB
 *   node scripts/ci/db-kontrakt-jmenovite.mjs --vypis <jméno>...  jen vypíše soubory
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isDirectRun } from "../lib/cli-entry.mjs";

const PREDPONA = "node scripts/db/with-throwaway-db.mjs -- npx vitest run ";
const SOUBOR = /^src\/tests\/db\/[\w.-]+\.test\.ts$/;

/**
 * Z `scripts` v package.json vybere soubory jmenovaných sad.
 * @param {Record<string, string>} scripts
 * @param {string[]} jmena
 * @param {(cesta: string) => boolean} [existuje]
 * @returns {{ soubory: string[], chyby: string[] }}
 */
export function souboryZeSkriptu(scripts, jmena, existuje = existsSync) {
  const soubory = [];
  const chyby = [];
  if (jmena.length === 0) chyby.push("žádné jméno sady — lane by neměřila nic");
  for (const jmeno of jmena) {
    const klic = `test:db:${jmeno}`;
    const prikaz = scripts[klic];
    if (prikaz === undefined) {
      chyby.push(`${klic}: v package.json není`);
      continue;
    }
    if (!prikaz.startsWith(PREDPONA)) {
      chyby.push(`${klic}: neznámý tvar „${prikaz}“ — čekám „${PREDPONA}<soubory>“`);
      continue;
    }
    const casti = prikaz.slice(PREDPONA.length).trim().split(/\s+/);
    const cizi = casti.filter((c) => !SOUBOR.test(c));
    if (cizi.length > 0) {
      chyby.push(`${klic}: kromě souborů nese ${cizi.join(" ")} — sloučení by ho změnilo`);
      continue;
    }
    for (const s of casti) {
      if (!existuje(s)) chyby.push(`${klic}: soubor ${s} neexistuje`);
      else if (!soubory.includes(s)) soubory.push(s);
    }
  }
  return { soubory, chyby };
}

function hlavni(argv) {
  const vypis = argv[0] === "--vypis";
  const jmena = vypis ? argv.slice(1) : argv;
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  const { soubory, chyby } = souboryZeSkriptu(scripts, jmena);
  if (chyby.length > 0) {
    for (const c of chyby) console.error(`::error title=db-kontrakt-jmenovite::${c}`);
    process.exit(1);
  }
  console.error(`db-kontrakt: ${jmena.length} sad → ${soubory.length} souborů v jedné throwaway DB`);
  if (vypis) {
    process.stdout.write(`${soubory.join("\n")}\n`);
    return;
  }
  const r = spawnSync(
    "node",
    ["scripts/db/with-throwaway-db.mjs", "--", "npx", "vitest", "run", "--no-file-parallelism", ...soubory],
    { stdio: "inherit" },
  );
  if (r.error) {
    console.error(`::error title=db-kontrakt-jmenovite::spuštění selhalo: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

if (isDirectRun(import.meta.url)) hlavni(process.argv.slice(2));
