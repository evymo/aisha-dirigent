#!/usr/bin/env node
/**
 * poradi-sestaveni-balicku.mjs — pořadí sestavení balíčků workspace, ODVOZENÉ
 * z grafu závislostí. Jeden domov pro všechny, kdo balíčky sestavují.
 *
 * ⛔ NAMĚŘENO 2026-10-03: vydávání balíčků v CI končilo pádem pokaždé, když bylo
 * co vydat — doloženo logy běhů od 2026-06-11; registr dostával verze jen ručně.
 * Balíček, který závisí na jiném balíčku z repa, hledá jeho typy v `dist/` —
 * a to vznikne až sestavením. Pořadí přitom nikdo neřídil: jedno místo stavělo
 * abecedně a jen to, co vydává, druhé abecedně s opakováním „dokud to neprojde“.
 * Dvě místa, dvě různé odpovědi na tutéž otázku — a žádná z kódu balíčků.
 *
 * Pořadí se proto NEVYJMENOVÁVÁ. Čte se z `package.json` balíčků: závislost
 * (dependencies, devDependencies, peerDependencies, optionalDependencies) se
 * jménem jiného balíčku z `packages/` = hrana grafu. Nový balíček nebo nová
 * závislost jsou pokryté bez zásahu sem.
 *
 * Balíček bez skriptu `build` se nestaví, ale jeho závislosti se procházejí dál.
 * Cyklus je CHYBA nahlas (kód 1), ne „nějaké pořadí“.
 *
 * CO NEMĚŘÍ: závislost, kterou `package.json` nedeklaruje (import cestou do
 * cizího `dist/`, `paths` v tsconfigu). Taková hrana v grafu není.
 *
 * CLI:
 *   --seznam [packages/<x> …]   pořadí sestavení (závislosti dřív), jeden na řádek;
 *                               bez argumentů všechny sestavitelné balíčky
 * Kódy: 0 ok · 1 cyklus nebo neznámý balíček · 2 špatné použití.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { porovnej } from "./razeni.mjs";

const KOREN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DRUHY_ZAVISLOSTI = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/**
 * Graf balíčků workspace: `packages/<adresář>` → { jmeno, sestavitelny, zavisi }.
 * `zavisi` jsou adresáře balíčků z repa, na kterých balíček závisí (seřazené).
 *
 * @param {string} [koren]
 * @returns {Map<string, { jmeno: string, sestavitelny: boolean, zavisi: string[] }>}
 */
export function grafBalicku(koren = KOREN) {
  const dir = join(koren, "packages");
  const nacteno = [];
  if (existsSync(dir)) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const pj = join(dir, e.name, "package.json");
      if (!e.isDirectory() || !existsSync(pj)) continue;
      nacteno.push({ cesta: `packages/${e.name}`, pkg: JSON.parse(readFileSync(pj, "utf8")) });
    }
  }
  const podleJmena = new Map(nacteno.filter((b) => b.pkg.name).map((b) => [String(b.pkg.name), b.cesta]));
  const graf = new Map();
  for (const { cesta, pkg } of nacteno.sort((a, b) => porovnej(a.cesta, b.cesta))) {
    const zavisi = new Set();
    for (const druh of DRUHY_ZAVISLOSTI) {
      for (const jmeno of Object.keys(pkg[druh] ?? {})) {
        const cil = podleJmena.get(jmeno);
        if (cil && cil !== cesta) zavisi.add(cil);
      }
    }
    graf.set(cesta, {
      jmeno: String(pkg.name ?? cesta),
      sestavitelny: Boolean(pkg.scripts?.build),
      zavisi: [...zavisi].sort(porovnej),
    });
  }
  return graf;
}

/**
 * Pořadí sestavení: každý balíček až PO všech svých závislostech z repa.
 * Deterministické (při volbě abecedně), jen balíčky se skriptem `build`.
 *
 * @param {Map<string, { sestavitelny: boolean, zavisi: string[] }>} graf
 * @param {Iterable<string>|null} [cile] `packages/<x>`; null = všechny. Vrací se
 *        cíle VČETNĚ všeho, na čem (i nepřímo) závisí.
 * @returns {string[]}
 */
export function poradiZGrafu(graf, cile = null) {
  const koreny = cile === null ? [...graf.keys()] : [...cile];
  const nezname = koreny.filter((c) => !graf.has(c));
  if (nezname.length > 0) throw new Error(`neznámý balíček workspace: ${nezname.join(", ")}`);

  const hotove = new Set();
  const naCeste = [];
  const out = [];
  const navstiv = (cesta) => {
    if (hotove.has(cesta)) return;
    const i = naCeste.indexOf(cesta);
    if (i !== -1) throw new Error(`cyklus závislostí mezi balíčky: ${[...naCeste.slice(i), cesta].join(" → ")}`);
    naCeste.push(cesta);
    for (const z of graf.get(cesta).zavisi) navstiv(z);
    naCeste.pop();
    hotove.add(cesta);
    if (graf.get(cesta).sestavitelny) out.push(cesta);
  };
  for (const c of koreny.sort(porovnej)) navstiv(c);
  return out;
}

/** Pořadí sestavení nad stromem repa — viz poradiZGrafu. */
export function poradiSestaveni(koren = KOREN, cile = null) {
  return poradiZGrafu(grafBalicku(koren), cile);
}

/**
 * Sestaví cíl VČETNĚ závislostí z repa — každý balíček nejvýš jednou za běh.
 * Vlastní sestavení dodá volající (`sestav`); tady je jen pořadí a paměť běhu.
 *
 * @param {{ koren?: string, cil: string, sestav: (balicek: string) => void, hotove: Set<string>, graf?: Map<string, { sestavitelny: boolean, zavisi: string[] }> }} p
 *        `hotove` drží volající přes celý běh; `graf` jen pro testy.
 * @returns {string[]} co se v tomto volání sestavilo, v pořadí
 */
export function sestavSeZavislostmi({ koren = KOREN, cil, sestav, hotove, graf = null }) {
  const ted = [];
  for (const b of poradiZGrafu(graf ?? grafBalicku(koren), [cil])) {
    if (hotove.has(b)) continue;
    try {
      sestav(b);
    } catch (e) {
      if (b === cil) throw e;
      // Jmenuje se ZÁVISLOST: balíček, který se kvůli ní nepostavil, rozbitý není.
      throw new Error(`závislost ${b} se nesestavila — ${e?.message ?? e}`, { cause: e });
    }
    hotove.add(b);
    ted.push(b);
  }
  return ted;
}

function main(argv) {
  if (argv[0] !== "--seznam") {
    process.stderr.write("poradi-sestaveni-balicku: --seznam [packages/<x> …]\n");
    return 2;
  }
  const cile = argv.slice(1).map((c) => c.replace(/\/+$/, ""));
  try {
    const poradi = poradiSestaveni(KOREN, cile.length > 0 ? cile : null);
    for (const b of poradi) process.stdout.write(`${b}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`poradi-sestaveni-balicku: ${e.message}\n`);
    return 1;
  }
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
