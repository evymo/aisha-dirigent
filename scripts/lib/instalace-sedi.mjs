#!/usr/bin/env node
/**
 * Sedí instalace `node_modules` na `package-lock.json`? — za desítky milisekund.
 *
 * PROČ
 * Pre-push pouští celou offline sadu (~10 min). Když worktree nese cizí nebo
 * zastaralou instalaci, sada spadne až v `test:services` hláškou
 * `Cannot find module 'ajv/dist/2020.js'` v balíku, na který změna vůbec
 * nesahá — a čte se to jako vada kódu. Naměřeno 2026-09-24: worktree se
 * symlinkem na node_modules jiného worktree → 35 min fronty sdíleného slotu
 * a pád pre-push; stejná třída se opakovala 09-23 i 09-24 v jiných relacích.
 *
 * CO SE KONTROLUJE (každé = STOP s návodem, žádné „nevím, tak dál")
 *   1. `node_modules` existuje a NENÍ symlink (symlink nese cizí lockfile i cizí
 *      vnořené node_modules; `build:packages` ho navíc umí přepsat neúplným adresářem),
 *   2. `node_modules/.package-lock.json` existuje (npm ho píše při každé instalaci;
 *      chybí = instalace nedoběhla nebo nevznikla přes npm),
 *   3. každý balík z `package-lock.json` je v instalaci ve STEJNÉ verzi
 *      (volitelné balíky jiné platformy se přeskočí),
 *   4. co instalace eviduje, na disku skutečně leží (vnořené node_modules
 *      workspaců — přesně ty chyběly u `ajv/dist/2020.js`).
 *
 * Použití: `node scripts/lib/instalace-sedi.mjs [kořen]` → exit 0 / 1.
 */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDirectRun } from "./cli-entry.mjs";

const NAVOD = "Oprava: `npm ci && npm run build:packages` v TOMTO worktree (těžké úlohy přes sdílený slot).";

/** @returns {string[]} nálezy; prázdné pole = instalace sedí */
export function instalaceSedi(koren) {
  const nm = path.join(koren, "node_modules");
  if (!existsSync(nm)) return ["node_modules chybí — instalace neproběhla."];
  if (lstatSync(nm).isSymbolicLink()) {
    return ["node_modules je symlink — nese cizí lockfile i cizí vnořené node_modules, pre-push ho nesnese."];
  }
  const skrytyCesta = path.join(nm, ".package-lock.json");
  if (!existsSync(skrytyCesta)) {
    return ["node_modules/.package-lock.json chybí — nelze ověřit, že instalace odpovídá lockfilu."];
  }
  const lock = JSON.parse(readFileSync(path.join(koren, "package-lock.json"), "utf8")).packages ?? {};
  const skryty = JSON.parse(readFileSync(skrytyCesta, "utf8")).packages ?? {};

  const nalezy = [];
  for (const [klic, ocekavano] of Object.entries(lock)) {
    if (!klic.includes("node_modules/")) continue; // kořen a zdroje workspaců
    const je = skryty[klic];
    if (!je) {
      if (!ocekavano.optional && !ocekavano.peer) nalezy.push(`chybí ${klic}@${ocekavano.version}`);
      continue;
    }
    if (ocekavano.version !== je.version) nalezy.push(`${klic}: nainstalováno ${je.version}, lockfile chce ${ocekavano.version}`);
  }
  for (const klic of Object.keys(skryty)) {
    if (!lock[klic]) nalezy.push(`navíc ${klic} (lockfile ho nezná)`);
    else if (!existsSync(path.join(koren, klic))) nalezy.push(`eviduje ${klic}, ale na disku není`);
  }
  return nalezy;
}

if (isDirectRun(import.meta.url)) {
  const koren = path.resolve(process.argv[2] ?? process.cwd());
  const nalezy = instalaceSedi(koren);
  if (nalezy.length === 0) {
    console.log("✓ node_modules sedí na package-lock.json");
  } else {
    console.error(`✗ node_modules NESEDÍ na package-lock.json (${nalezy.length}):`);
    for (const n of nalezy.slice(0, 10)) console.error(`    ${n}`);
    if (nalezy.length > 10) console.error(`    … a dalších ${nalezy.length - 10}`);
    console.error(`  ${NAVOD}`);
    process.exit(1);
  }
}
