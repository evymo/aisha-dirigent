/**
 * Brána: řídký checkout nese CELÝ statický graf importů každého skriptu, který stahuje.
 *
 * ⛔ NAMĚŘENO 2026-09-25 (revize aisha-team, ověřeno): `scripts/coolify-deploy-watch.mjs`
 * importuje `./lib/coolify-app-status.mjs`, a ten v řídkém checkoutu deploy úloh NEBYL.
 * Fungovalo to jen proto, že `actions/checkout` má výchozí cone mode, který přibalí
 * sourozence z `scripts/lib/`. Vypnutý cone mode = pád na importu v každém nasazení.
 * Dosavadní brána (doruceni-povinnych-promennych) hlídala graf JEDNÉ knihovny a její
 * regex bral jen importy v dvojitých uvozovkách.
 *
 * Měří se: pro KAŽDÝ blok `sparse-checkout:` ve workflow a každý vyjmenovaný `.mjs/.js`
 * soubor tranzitivní graf relativních importů (import … from, export … from, holý
 * `import "x"`, dynamický `import("x")` s literálem; obě uvozovky). Každý importovaný
 * soubor musí být v bloku VÝSLOVNĚ, nebo pod vyjmenovaným adresářem (`scripts/`).
 * Na cone mode se nespoléhá.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import yaml from "js-yaml";
import { dirname, join, normalize } from "node:path";

const ROOT = process.cwd();
const WORKFLOWY = [".forgejo/workflows/ci.yml", ".forgejo/workflows/deploy.yml"];

/** Relativní specifikátory importů v jednom souboru (bez komentářových řádků). */
export function relativniImporty(zdroj: string): string[] {
  const kod = zdroj
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*|\/\*)/.test(r))
    .join("\n");
  const vzory = [
    /\bimport\s[^;]*?\bfrom\s*(["'])(\.{1,2}\/[^"']+)\1/g, // import x from "./a"
    /\bexport\s[^;]*?\bfrom\s*(["'])(\.{1,2}\/[^"']+)\1/g, // export … from './a'
    /\bimport\s*(["'])(\.{1,2}\/[^"']+)\1/g, // import "./a" (vedlejší efekt)
    /\bimport\s*\(\s*(["'])(\.{1,2}\/[^"']+)\1\s*\)/g, // import("./a")
  ];
  const out = new Set<string>();
  for (const re of vzory) for (const m of kod.matchAll(re)) out.add(m[2]);
  return [...out];
}

function grafImportu(start: string, videno = new Set<string>()): Set<string> {
  if (videno.has(start) || !existsSync(join(ROOT, start))) return videno;
  videno.add(start);
  for (const spec of relativniImporty(readFileSync(join(ROOT, start), "utf8"))) {
    grafImportu(normalize(join(dirname(start), spec)), videno);
  }
  return videno;
}

function ridkeBloky(): Array<{ wf: string; cesty: string[] }> {
  const bloky: Array<{ wf: string; cesty: string[] }> = [];
  for (const wf of WORKFLOWY) {
    // Po řádcích, ne regexem přes víc řádků: `\s+` by pohltil i konce řádků
    // (první verze téhle brány tak našla 2 bloky místo 8).
    const radky = readFileSync(join(ROOT, wf), "utf8").split("\n");
    for (let i = 0; i < radky.length; i++) {
      if (!/^\s*sparse-checkout:\s*\|\s*$/.test(radky[i])) continue;
      const odsazeni = /^(\s*)/.exec(radky[i + 1] ?? "")?.[1] ?? "";
      const cesty: string[] = [];
      for (let j = i + 1; j < radky.length; j++) {
        const r = radky[j];
        if (!r.trim()) break;
        if (!r.startsWith(odsazeni) || /^\s/.test(r.slice(odsazeni.length))) break;
        cesty.push(r.trim());
      }
      if (cesty.length) bloky.push({ wf, cesty });
    }
  }
  return bloky;
}

describe("řídký checkout nese celý graf importů stažených skriptů", () => {
  it("parser importů bere obě uvozovky, export-from, holý i dynamický import", () => {
    expect(
      relativniImporty(
        [
          `import a from "./a.mjs";`,
          `import { b } from './b.mjs';`,
          `export { c } from "./c.mjs";`,
          `import "./d.mjs";`,
          `const e = await import('./e.mjs');`,
          `// import x from "./komentar.mjs";`,
          `import f from "node:fs";`,
        ].join("\n"),
      ).sort(),
    ).toEqual(["./a.mjs", "./b.mjs", "./c.mjs", "./d.mjs", "./e.mjs"]);
  });

  it("každý importovaný soubor je v témže bloku výslovně nebo pod vyjmenovaným adresářem", () => {
    const bloky = ridkeBloky();
    // Nula bloků by podmínku splnila triviálně.
    expect(bloky.length).toBeGreaterThanOrEqual(5);
    // Měřidlo musí vidět známou hranu, jinak parser přestal sedět.
    expect([...grafImportu("scripts/coolify-deploy-watch.mjs")]).toContain("scripts/lib/coolify-app-status.mjs");

    const chybi: string[] = [];
    for (const { wf, cesty } of bloky) {
      const adresare = cesty.filter((c) => c.endsWith("/"));
      const kryto = (soubor: string) => cesty.includes(soubor) || adresare.some((a) => soubor.startsWith(a));
      for (const start of cesty.filter((c) => /\.(mjs|js)$/.test(c))) {
        for (const soubor of grafImportu(start)) {
          if (!kryto(soubor)) chybi.push(`${wf}: ${start} → ${soubor}`);
        }
      }
    }
    expect(
      [...new Set(chybi)],
      "řídký checkout nestáhne soubor, který stažený skript importuje — node spadne na importu,\n" +
        "jakmile se cone mode actions/checkout vypne (dnes to drží jen náhoda sourozenců).",
    ).toEqual([]);
  });
});

// ── Graf, který řídké úlohy SPOUŠTĚJÍ, se musí načíst BEZ balíků ─────────────────
// ⛔ NAMĚŘENO 2026-10-01 (main fa7c6d6d6, běh 4139): aisha-redeploy.mjs dostal statický
// import lib/obrazy-stacku.mjs a ten `import yaml from "js-yaml"`. Nasazovací úlohy běží
// z řídkého checkoutu (scripts/, instances/) BEZ `npm ci` → `--print-waves` spadl na
// ERR_MODULE_NOT_FOUND a nenasadilo se nic. Relativní graf výš byl v pořádku; chybělo
// měřidlo pro HOLÉ specifikátory. Statický import se vyhodnotí při načtení modulu, takže
// rozhoduje statický graf; dynamický import/require uvnitř funkce se načte až při volání.

const VESTAVENE = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** Holé (balíkové) specifikátory statických importů jednoho souboru. */
export function holeStatickeImporty(zdroj: string): string[] {
  const kod = zdroj
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*|\/\*)/.test(r))
    .join("\n");
  const vzory = [
    /(?:^|\n)\s*import\s[^;]*?\bfrom\s*(["'])([^"'.][^"']*)\1/g,
    /(?:^|\n)\s*export\s[^;]*?\bfrom\s*(["'])([^"'.][^"']*)\1/g,
    /(?:^|\n)\s*import\s*(["'])([^"'.][^"']*)\1/g,
  ];
  const out = new Set<string>();
  for (const re of vzory) for (const m of kod.matchAll(re)) if (!VESTAVENE.has(m[2])) out.add(m[2]);
  return [...out];
}

/** Vstupní node skripty úloh, které mají řídký checkout a NEDĚLAJÍ `npm ci`. */
function vstupyRidkychUloh(): string[] {
  const vstupy = new Set<string>();
  const shProjite = new Set<string>();
  const zeSh = (sh: string) => {
    if (shProjite.has(sh) || !existsSync(join(ROOT, sh))) return;
    shProjite.add(sh);
    const t = readFileSync(join(ROOT, sh), "utf8");
    for (const m of t.matchAll(/\bnode\s+"?(?:\$\{?[A-Z_]+\}?\/)?(scripts\/[\w./-]+\.m?js)/g)) vstupy.add(m[1]);
    for (const m of t.matchAll(/\b(?:bash|sh)\s+"?(?:\$\{?[A-Z_]+\}?\/)?(scripts\/[\w./-]+\.sh)/g)) zeSh(m[1]);
  };
  for (const wf of WORKFLOWY) {
    if (!existsSync(join(ROOT, wf))) continue;
    const doc = yaml.load(readFileSync(join(ROOT, wf), "utf8")) as { jobs?: Record<string, { steps?: Array<Record<string, unknown>> }> };
    for (const job of Object.values(doc?.jobs ?? {})) {
      const kroky = job?.steps ?? [];
      const ridky = kroky.some((k) => typeof (k.with as Record<string, unknown> | undefined)?.["sparse-checkout"] === "string");
      const runy = kroky.map((k) => (typeof k.run === "string" ? k.run : "")).join("\n");
      if (!ridky || /\bnpm\s+(ci|install)\b/.test(runy)) continue;
      for (const m of runy.matchAll(/\bnode\s+"?(scripts\/[\w./-]+\.m?js)/g)) vstupy.add(m[1]);
      for (const m of runy.matchAll(/\b(?:bash|sh)\s+"?(scripts\/[\w./-]+\.sh)/g)) zeSh(m[1]);
    }
  }
  return [...vstupy].sort();
}

describe("řídké úlohy bez npm ci: spouštěný graf nenačítá balíky", () => {
  it("parser holých importů bere statické importy a pouští vestavěné moduly i dynamické načtení", () => {
    expect(
      holeStatickeImporty(
        [
          `import yaml from "js-yaml";`,
          `import { x } from '@scope/pkg';`,
          `export { y } from "other";`,
          `import "side-effect";`,
          `import fs from "node:fs";`,
          `import path from "path";`,
          `import a from "./rel.mjs";`,
          `const z = createRequire(import.meta.url)("lazy");`,
          `const w = await import("dyn");`,
          `// import k from "komentar";`,
        ].join("\n"),
      ).sort(),
    ).toEqual(["@scope/pkg", "js-yaml", "other", "side-effect"]);
  });

  it("žádný soubor statického grafu vstupů řídkých úloh neimportuje balík", () => {
    const vstupy = vstupyRidkychUloh();
    // Měřidlo musí vidět známé vstupy, jinak přestalo číst workflow.
    expect(vstupy).toContain("scripts/aisha-redeploy.mjs");
    expect(vstupy.length).toBeGreaterThanOrEqual(5);
    const nalezy: string[] = [];
    for (const v of vstupy) {
      for (const soubor of grafImportu(v)) {
        for (const balik of holeStatickeImporty(readFileSync(join(ROOT, soubor), "utf8"))) {
          nalezy.push(`${v} → ${soubor}: "${balik}"`);
        }
      }
    }
    expect(
      [...new Set(nalezy)],
      "řídká úloha bez `npm ci` nemá node_modules — statický import balíku shodí skript při NAČTENÍ.\n" +
        "Balík načti až ve funkci, která ho potřebuje (createRequire / await import), nebo úloze přidej npm ci.",
    ).toEqual([]);
  });
});
