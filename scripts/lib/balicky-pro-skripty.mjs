/**
 * balicky-pro-skripty.mjs — workspace balíčky, které operátorské skripty importují
 * SESTAVENÉ (`../packages/<x>/dist/…`), a jejich sestavení.
 *
 * ⛔ NAMĚŘENO 2026-10-03 (konvergence instance forku, krok 4): knock-provision → knock-roster.mjs
 * importuje `packages/knock-protocol/dist`. V konvergenčním stromu dist nebyl
 * (gitignored; cold-start balíčky nikdy nesestavoval, doktor to nehlídal) a dveře
 * padly. Stejně tak by tiše běžel ZASTARALÝ dist z dřívějšího stromu.
 *
 * Seznam se ODVOZUJE z kódu skriptů, ne vyjmenovává: nový skript s cestou do dist
 * dalšího balíčku je pokrytý bez zásahu sem. Cold-start sestaví vždy (zastaralý
 * dist je stejná vada jako chybějící, tsc malého balíčku stojí sekundy).
 *
 * ⛔ HRANICE ODVOZENÍ NESMÍ BÝT TICHÉ (nedůvěřivé čtení 2026-10-03, nález 5):
 *   · sken četl jen `scripts/` a `scripts/lib/` — podadresáře (db, deploy, ci, …)
 *     mimo něj a nikde to nestálo. Čte se proto CELÉ `scripts/` rekurzivně a výstup
 *     říká, kolik souborů prošlo a co zůstalo mimo (testy, přípony, které nejsou kód);
 *   · import balíčku workspace JMÉNEM (`from '@scope/balicek'`) se počítal jako „nic“.
 *     Jméno se přitom přes `main`/`exports` balíčku rozloží do téhož dist — skript by
 *     spadl stejně, jen by ho odvození nevidělo. Takový import je proto NÁLEZ nahlas:
 *     `--zkontroluj` i `--sestav` skončí kódem 1 a jmenují soubor i balíček.
 *
 * CO `--zkontroluj` NEMĚŘÍ: za nástroj buildu bere PRVNÍ slovo skriptu `build` a hledá ho
 * jen v node_modules/.bin (balíčku a kořene) — nástroj dostupný přes PATH (`node …`,
 * `npm run …`) by ohlásil jako nenainstalovaný a další nástroje složeného skriptu nevidí.
 *
 * CLI:
 *   --seznam       vypíše odvozené balíčky (packages/<x>)
 *   --zkontroluj   jen čte: má každý skript `build` a jde jeho nástroj spustit? (doktor)
 *   --sestav       `npm run build --workspace=packages/<x>` pro každý (cold-start) — včetně balíčků
 *                  z repa, na kterých odvozené stojí, v pořadí z grafu závislostí
 *                  (lib/poradi-sestaveni-balicku.mjs; pořadí má v repu jeden domov)
 * Kódy: 0 ok · 1 sestavení/kontrola selhala nebo skript importuje balíček jménem
 *       · 2 měřidlo nic nenašlo (osiřelé).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { poradiSestaveni } from "./poradi-sestaveni-balicku.mjs";

const KOREN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Přípony, které sken čte jako kód. Ostatní vyjmenuje výstup jako neprohledané. */
const PRIPONY_KODU = new Set([".mjs", ".js", ".cjs", ".ts", ".sh"]);

/** Test se nespouští v cold-startu — jeho importy sestavení neřídí. */
const jeTest = (cesta) => /\.(test|spec)\.[cm]?[jt]s$/.test(cesta) || cesta.split("/").includes("__tests__");

/** Řádky kódu: komentář (`#`, `//`, `*`, `/*`) popisuje, neimportuje. */
const bezKomentaru = (text) =>
  String(text)
    .split("\n")
    .filter((r) => !/^\s*(#|\/\/|\*|\/\*)/.test(r))
    .join("\n");

/**
 * Balíčky, na jejichž dist text míří cestou — relativním importem (`../packages/x/dist/…`)
 * i jakkoli jinak (`node packages/x/dist/cli.js`, `"$KOREN/packages/x/dist/…"`).
 */
export function balickyZTextu(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(?:^|[^\w.-])packages\/([\w.-]+)\/dist\//gm)) out.add(`packages/${m[1]}`);
  return out;
}

/** Jména balíčků workspace: `name` z packages/<adresář>/package.json → `packages/<adresář>`. */
export function jmenaBalicku(koren = KOREN) {
  const out = new Map();
  const dir = join(koren, "packages");
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const pj = join(dir, e.name, "package.json");
    if (!e.isDirectory() || !existsSync(pj)) continue;
    const jmeno = JSON.parse(readFileSync(pj, "utf8")).name;
    if (jmeno) out.set(String(jmeno), `packages/${e.name}`);
  }
  return out;
}

/**
 * Balíčky workspace, které text importuje JMÉNEM (i podcestou `jméno/…`):
 * `import … from`, `export … from`, `import '…'`, `import('…')`, `require('…')`.
 * Statický import musí začínat řádek — text kódu uvnitř řetězce (generátor,
 * přepisovač zdrojáků) import skriptu není.
 *
 * @param {string} text zdroj bez komentářů
 * @param {Iterable<string>} jmena jména balíčků workspace
 * @returns {Set<string>}
 */
export function importyJmenem(text, jmena) {
  const zname = [...jmena];
  const out = new Set();
  const vzory = [
    /^[ \t]*(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/gm,
    /^[ \t]*import\s*(['"])([^'"\n]+)\1/gm,
    /\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  ];
  for (const vzor of vzory) {
    for (const m of String(text).matchAll(vzor)) {
      const jmeno = zname.find((j) => m[2] === j || m[2].startsWith(`${j}/`));
      if (jmeno) out.add(jmeno);
    }
  }
  return out;
}

/**
 * Projde CELÉ `scripts/` (rekurzivně, bez node_modules a testů).
 *
 * @returns {{
 *   balicky: string[],                                   // packages/<x> s cestou do dist
 *   jmenem: { soubor: string, balicek: string, cesta: string }[],  // importy JMÉNEM (nález)
 *   prohledano: number,                                  // souborů čtených jako kód
 *   neprohledano: Record<string, number>,                // co zůstalo mimo: "testy", ".md", …
 * }}
 */
export function prohledejSkripty(koren = KOREN) {
  const jmena = jmenaBalicku(koren);
  const balicky = new Set();
  const jmenem = [];
  const neprohledano = {};
  let prohledano = 0;
  const mimo = (klic) => {
    neprohledano[klic] = (neprohledano[klic] ?? 0) + 1;
  };
  const projdi = (adresar) => {
    for (const e of readdirSync(adresar, { withFileTypes: true })) {
      const plna = join(adresar, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") projdi(plna);
        continue;
      }
      const rel = relative(koren, plna).split("\\").join("/");
      if (jeTest(rel)) {
        mimo("testy");
        continue;
      }
      const pripona = extname(e.name) || "(bez přípony)";
      if (!PRIPONY_KODU.has(pripona)) {
        mimo(pripona);
        continue;
      }
      prohledano++;
      const kod = bezKomentaru(readFileSync(plna, "utf8"));
      for (const b of balickyZTextu(kod)) balicky.add(b);
      for (const j of importyJmenem(kod, jmena.keys())) jmenem.push({ soubor: rel, balicek: j, cesta: jmena.get(j) });
    }
  };
  projdi(join(koren, "scripts"));
  jmenem.sort((a, b) => (a.soubor + a.balicek < b.soubor + b.balicek ? -1 : 1));
  return { balicky: [...balicky].sort(), jmenem, prohledano, neprohledano };
}

/** Odvozené balíčky ze skriptů repozitáře (celé scripts/, bez testů). */
export function balickyProSkripty(koren = KOREN) {
  return prohledejSkripty(koren).balicky;
}

/** Nález importu jménem jako jedna věta pro člověka. */
export function popisImportuJmenem(n) {
  return (
    `${n.soubor}: importuje balíček workspace JMÉNEM '${n.balicek}' — odvození sestavení ho nevidí, ` +
    `takže by skript spadl na nesestaveném (nebo běžel se starým) balíčku. ` +
    `Importuj cestou do dist balíčku ${n.cesta} (tu odvození pokryje).`
  );
}

/** Co sken pokryl a co ne — věta do výstupu, aby hranice nebyla tichá. */
export function popisPokryti(sken) {
  const mimo = Object.entries(sken.neprohledano)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  return `prohledáno ${sken.prohledano} souborů v celém scripts/ (${[...PRIPONY_KODU].join(" ")}); mimo sken: ${mimo || "nic"}`;
}

/** Jde balíček sestavit? Vrací seznam vad (prázdný = ano). Jen čte. */
export function vadySestaveni(koren, balicek) {
  const pj = join(koren, balicek, "package.json");
  if (!existsSync(pj)) return [`${balicek}: package.json chybí`];
  const build = JSON.parse(readFileSync(pj, "utf8")).scripts?.build;
  if (!build) return [`${balicek}: package.json nemá skript build`];
  const nastroj = build.trim().split(/\s+/)[0];
  const kde = [join(koren, balicek, "node_modules/.bin", nastroj), join(koren, "node_modules/.bin", nastroj)];
  if (!kde.some((p) => existsSync(p))) return [`${balicek}: nástroj buildu '${nastroj}' není nainstalovaný (npm ci)`];
  return [];
}

/**
 * Co se má SESTAVIT a v jakém pořadí: odvozené balíčky a všechno z repa, na čem (i nepřímo)
 * stojí — závislost vždy dřív. Pořadí se nevymýšlí tady; bere se z grafu závislostí
 * (lib/poradi-sestaveni-balicku.mjs), stejně jako ho čte `build:packages` a vydávání balíčků.
 *
 * `bezPoradi` = odvozený balíček, který pořadí nenese (chybí package.json nebo skript build).
 * To je VADA, ne „nic k sestavení“ — skript, který ho importuje, by spadl.
 *
 * @param {string} koren
 * @param {string[]} balicky odvozené `packages/<x>`
 * @returns {{ poradi: string[], bezPoradi: string[] }}
 */
export function kSestaveni(koren, balicky) {
  const sManifestem = balicky.filter((b) => existsSync(join(koren, b, "package.json")));
  const poradi = poradiSestaveni(koren, sManifestem);
  return { poradi, bezPoradi: balicky.filter((b) => !poradi.includes(b)) };
}

function main(argv) {
  const sken = prohledejSkripty();
  const { balicky } = sken;
  // Import jménem je nález v KAŽDÉM režimu — seznam bez něj není úplný.
  const nalezyJmenem = sken.jmenem.map(popisImportuJmenem);
  for (const n of nalezyJmenem) process.stderr.write(`  ✗ ${n}\n`);
  if (balicky.length === 0) {
    process.stderr.write(`balicky-pro-skripty: žádný skript nemíří do dist balíčku workspace — měřidlo osiřelo? (${popisPokryti(sken)})\n`);
    return 2;
  }
  if (argv.includes("--seznam")) {
    process.stdout.write(`${balicky.join("\n")}\n`);
    return nalezyJmenem.length === 0 ? 0 : 1;
  }
  if (argv.includes("--zkontroluj")) {
    // Odvozené balíčky I jejich závislosti z repa: nesestavitelná závislost shodí sestavení stejně.
    let plan;
    try {
      plan = kSestaveni(KOREN, balicky);
    } catch (e) {
      process.stderr.write(`  ✗ pořadí sestavení nejde odvodit: ${e.message}\n`);
      return 1;
    }
    const keKontrole = [...new Set([...balicky, ...plan.poradi])];
    const vady = keKontrole.flatMap((b) => vadySestaveni(KOREN, b));
    for (const v of vady) process.stderr.write(`  ✗ ${v}\n`);
    if (vady.length === 0 && nalezyJmenem.length === 0) {
      process.stdout.write(`✓ sestavitelné: ${plan.poradi.join(", ")} — ${popisPokryti(sken)}\n`);
    }
    return vady.length === 0 && nalezyJmenem.length === 0 ? 0 : 1;
  }
  if (argv.includes("--sestav")) {
    if (nalezyJmenem.length > 0) {
      process.stderr.write("balicky-pro-skripty: nesestavuji — seznam balíčků není úplný (importy jménem výše)\n");
      return 1;
    }
    let plan;
    try {
      plan = kSestaveni(KOREN, balicky);
    } catch (e) {
      process.stderr.write(`balicky-pro-skripty: pořadí sestavení nejde odvodit — ${e.message}\n`);
      return 1;
    }
    if (plan.bezPoradi.length > 0) {
      for (const v of plan.bezPoradi.flatMap((b) => vadySestaveni(KOREN, b))) process.stderr.write(`  ✗ ${v}\n`);
      process.stderr.write(`balicky-pro-skripty: nesestavuji — ${plan.bezPoradi.join(", ")} nejde sestavit, a skripty ho importují\n`);
      return 1;
    }
    for (const b of plan.poradi) {
      try {
        execFileSync("npm", ["run", "build", `--workspace=${b}`], { cwd: KOREN, stdio: ["ignore", "inherit", "inherit"] });
      } catch (e) {
        console.error(
          `balicky-pro-skripty: sestavení ${b} selhalo (${String(e.message).split("\n")[0]}) — skripty, které ho importují, by běžely bez něj nebo se starým`,
        );
        return 1;
      }
      process.stdout.write(`✓ sestaveno: ${b}\n`);
    }
    process.stdout.write(`  (${popisPokryti(sken)})\n`);
    return 0;
  }
  process.stderr.write("balicky-pro-skripty: --seznam | --zkontroluj | --sestav\n");
  return 1;
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
