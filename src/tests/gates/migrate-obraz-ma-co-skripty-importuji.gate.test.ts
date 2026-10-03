/**
 * Gate: obraz `migrate` nese PRÁVĚ to, co jeho skripty za běhu importují.
 *
 * ⛔ NAMĚŘENO 2026-09-26 (obrazy aisha-core, hostitel na 89 % disku).
 * `Dockerfile.migrate` stavěl stupeň `deps` s `npm ci --include=dev` celého
 * monorepa — vrstva 1,09 GB na každém hostiteli, jen kvůli migracím. Sledování
 * importů ukázalo, že za běhu z ní nepoužil NIC: migrate, seed, compile-seed,
 * provision-operators i celá dráha n8n-workflow-init (týž obraz) sahají
 * výhradně na vestavěné moduly node; zbytek dělá psql, git, curl, jq, bash.
 * Obraz teď node_modules nenese vůbec.
 *
 * Tahle brána drží obě strany téže vlastnosti:
 *   - kdyby skript z obrazu začal importovat balík, zčervená a řekne KTERÝ
 *     (a odkud) — pak se má nainstalovat JEN ten, ne znovu celý strom;
 *   - dokud skripty nic neimportují, obraz nesmí npm instalovat nic —
 *     gigabajt, který nikdo nečte, je přesně ta vada, kvůli které vznikla.
 *
 * ⭐ VSTUPY SE ODVOZUJÍ, NEVYJMENOVÁVAJÍ. Kdo obraz spouští, říká compose
 * (`build.dockerfile: Dockerfile.migrate` → `command`, výchozí cesty hooků
 * v `environment`) a Dockerfile (`CMD` → `COPY … /entrypoint.sh`). Nová služba
 * nad týmž obrazem se tak do měření dostane sama.
 *
 * ⭐ SLEDUJE SE SPUŠTĚNÍ, NE ZMÍNKA. Ze shellu jen `node|sh|bash|exec|source|.`
 * s cestou, přiřazení cesty do proměnné a `npm run <skript>` (→ package.json);
 * z JS relativní importy (statické, dynamické, require) a `join/resolve(…,
 * "x.mjs")` (spuštění node s cestou z join). První prototyp bral
 * každou cestu ve skriptu — a přes hlášky typu „spusť generate-secrets.mjs"
 * doputoval ke 113 souborům a nahlásil `js-yaml` z nástroje, který v obrazu
 * nikdy neběží. Slepé měřidlo hlásí zeleně i červeně stejně špatně.
 *
 * Brána nespouští podproces — čte soubory (ratchet drah bran).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();
const DOCKERFILE = "Dockerfile.migrate";
const VESTAVENE = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };

const cti = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const jeSoubor = (abs: string): boolean => existsSync(abs) && statSync(abs).isFile();

/** JS bez komentářů. `[^:]` chrání `https://` v řetězcích. */
const bezJsKomentaru = (zdroj: string): string =>
  zdroj.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
/** Shell / Dockerfile bez řádkových komentářů. */
const bezShKomentaru = (zdroj: string): string =>
  zdroj
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");

/** Jméno balíku ze specifikátoru: `@scope/x/y` → `@scope/x`, `x/y` → `x`. */
const jmenoBaliku = (spec: string): string =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;

/** Specifikátory importů v JS — statický import/export … from, dynamický import("…"), require("…"). */
export function specifikatory(zdroj: string): string[] {
  const out = new Set<string>();
  for (const m of zdroj.matchAll(/(?:^|[\s;}])(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']/gm)) out.add(m[1]!);
  for (const m of zdroj.matchAll(/\bimport\s*\(\s*["'`]([^"'`$]+)["'`]\s*\)/g)) out.add(m[1]!);
  for (const m of zdroj.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]!);
  return [...out];
}

/** Holé balíky mezi specifikátory (bez relativních cest a vestavěných modulů). */
export function holeBaliky(zdroj: string): string[] {
  return [
    ...new Set(
      specifikatory(zdroj)
        .filter((s) => !s.startsWith(".") && !s.startsWith("/"))
        .filter((s) => !VESTAVENE.has(s) && !VESTAVENE.has(jmenoBaliku(s)))
        .map(jmenoBaliku),
    ),
  ];
}

// Cesta k repo souboru za interpretem: `node scripts/x.mjs`, `node "${APP_DIR}/scripts/x.mjs"`,
// `source "$ROOT/scripts/lib/x.sh"`, `"$(dirname "$0")/../infra/lib/x.sh"`.
const PRED = String.raw`(?:"?(?:\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|\$\([^)]*\))"?\/)?(?:\.\.\/)*`;
const CESTA = String.raw`((?:scripts|infra)\/[\w./-]+\.(?:sh|mjs|cjs|js))`;
const SPUSTENI = new RegExp(String.raw`(?:^|[\s;&|(])(?:node|sh|bash|exec|source|\.)\s+(?:-[\w-]+\s+)*"?` + PRED + CESTA, "gm");
const PRIRAZENI = new RegExp(String.raw`\b[A-Za-z_][A-Za-z0-9_]*="?` + PRED + CESTA, "g");
// `. "${0%/*}/../lib/x.sh"` — relativně k adresáři skriptu, ne ke kořeni.
const VEDLE_SKRIPTU = /\$\{0%\/\*\}\/((?:\.\.\/)*[\w./-]+\.(?:sh|mjs|cjs))/g;

/** Repo cesty, které shellový text SPOUŠTÍ nebo zdrojuje (ne jen zmiňuje). */
export function spusteneCesty(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(SPUSTENI)) out.push(m[1]!);
  for (const m of text.matchAll(PRIRAZENI)) out.push(m[1]!);
  return out;
}

interface Stopa {
  soubory: Set<string>;
  hole: Map<string, string[]>;
  npx: string[];
  nedeklarovaneNpmRun: string[];
  /** Relativní import, který nevede na soubor — slepé místo měřidla, ne „nic tam není". */
  nerozresene: string[];
}

/** Transitivně projde vše, co vstupy spouštějí nebo importují. */
function sleduj(vstupy: string[]): Stopa {
  const stopa: Stopa = { soubory: new Set(), hole: new Map(), npx: [], nedeklarovaneNpmRun: [], nerozresene: [] };

  const navstiv = (abs: string): void => {
    const rel = relative(ROOT, abs);
    if (stopa.soubory.has(rel) || !jeSoubor(abs)) return;
    stopa.soubory.add(rel);
    const zdroj = readFileSync(abs, "utf8");
    if (rel.endsWith(".sh")) shell(bezShKomentaru(zdroj), rel);
    else js(bezJsKomentaru(zdroj), abs, rel);
  };

  const shell = (text: string, rel: string): void => {
    for (const m of text.matchAll(/\bnpm\s+run\s+([\w:.-]+)/g)) {
      const skript = PKG.scripts?.[m[1]!];
      if (skript === undefined) stopa.nedeklarovaneNpmRun.push(`${rel}: npm run ${m[1]}`);
      else shell(skript, `${rel} → npm run ${m[1]}`);
    }
    for (const m of text.matchAll(/\bnpx\s+(?:-[\w-]+\s+)*([@\w./-]+)/g)) stopa.npx.push(`${rel}: npx ${m[1]}`);
    for (const c of spusteneCesty(text)) navstiv(resolve(ROOT, c));
    const adresar = rel.includes(" → ") ? ROOT : dirname(resolve(ROOT, rel));
    for (const m of text.matchAll(VEDLE_SKRIPTU)) navstiv(resolve(adresar, m[1]!));
  };

  const js = (text: string, abs: string, rel: string): void => {
    for (const s of specifikatory(text)) {
      if (s.startsWith(".") || s.startsWith("/")) {
        const cil = resolve(dirname(abs), s);
        if (jeSoubor(cil)) navstiv(cil);
        else stopa.nerozresene.push(`${rel} → ${s}`);
        continue;
      }
      if (VESTAVENE.has(s) || VESTAVENE.has(jmenoBaliku(s))) continue;
      const b = jmenoBaliku(s);
      stopa.hole.set(b, [...(stopa.hole.get(b) ?? []), rel]);
    }
    // compile-seed.mjs spouští node s argumentem `path.join(__dirname, "seed.mjs")`.
    for (const m of text.matchAll(/\b(?:join|resolve)\([^)]*?["'`]([\w./-]+\.(?:mjs|cjs))["'`]/g)) {
      const kandidat = [resolve(dirname(abs), m[1]!), resolve(ROOT, m[1]!)].find(jeSoubor);
      if (kandidat) navstiv(kandidat);
    }
  };

  for (const v of vstupy) navstiv(resolve(ROOT, v));
  return stopa;
}

interface Sluzba {
  kde: string;
  maPrikaz: boolean;
  cesty: string[];
}

/** Služby postavené z Dockerfile.migrate a repo cesty, které spouštějí. */
function sluzbyObrazu(): Sluzba[] {
  const out: Sluzba[] = [];
  for (const soubor of readdirSync(ROOT).filter((f) => /^docker-compose.*\.ya?ml$/.test(f)).sort()) {
    const doc = parseYaml(cti(soubor)) as { services?: Record<string, Record<string, unknown>> } | null;
    for (const [jmeno, sluzba] of Object.entries(doc?.services ?? {})) {
      const build = sluzba.build as { dockerfile?: string } | undefined;
      if (build?.dockerfile !== DOCKERFILE) continue;
      const prikaz = [sluzba.command, sluzba.entrypoint]
        .flatMap((x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]))
        .map(String)
        .join(" ");
      const prostredi = Array.isArray(sluzba.environment)
        ? (sluzba.environment as unknown[]).map(String)
        : Object.values((sluzba.environment ?? {}) as Record<string, unknown>).map(String);
      const cesty = [
        ...spusteneCesty(prikaz),
        ...[...prikaz.matchAll(/\/app\/((?:scripts|infra)\/[\w./-]+\.(?:sh|mjs|cjs))/g)].map((m) => m[1]!),
        // Výchozí hook (`${AISHA_IMPLEMENTATION_HOOK:-scripts/deploy/instance-data-hook.sh}`).
        ...prostredi.flatMap((v) => [...v.matchAll(/:-((?:scripts|infra)\/[\w./-]+\.(?:sh|mjs|cjs))\}/g)].map((m) => m[1]!)),
      ];
      out.push({ kde: `${soubor}:${jmeno}`, maPrikaz: prikaz.trim() !== "", cesty: [...new Set(cesty)] });
    }
  }
  return out;
}

/** `CMD ["/entrypoint.sh"]` + `COPY <zdroj> /entrypoint.sh` → repo cesta vstupu obrazu. */
function vstupZDockerfilu(): string | null {
  const df = bezShKomentaru(cti(DOCKERFILE));
  const cmd = /^CMD\s+\[\s*"([^"]+)"/m.exec(df)?.[1];
  if (!cmd) return null;
  const copy = [...df.matchAll(/^COPY\s+(?:--\S+\s+)*(\S+)\s+(\S+)\s*$/gm)].find((m) => m[2] === cmd);
  return copy?.[1] ?? null;
}

const SLUZBY = sluzbyObrazu();
const VSTUP_CMD = vstupZDockerfilu();
const VSTUPY = [...new Set([...(VSTUP_CMD ? [VSTUP_CMD] : []), ...SLUZBY.flatMap((s) => s.cesty)])];
const STOPA = sleduj(VSTUPY);

describe("obraz migrate nese právě to, co jeho skripty importují", () => {
  it("měřidlo najde služby obrazu a vstup z CMD — jinak je brána slepá", () => {
    expect(SLUZBY.length).toBeGreaterThan(0);
    expect(VSTUP_CMD, "CMD obrazu musí vést na soubor z repa (COPY … /entrypoint.sh)").not.toBeNull();
    expect(jeSoubor(resolve(ROOT, VSTUP_CMD ?? "—"))).toBe(true);
  });

  it("každá služba obrazu má vstup, který měřidlo vidí", () => {
    // Služba s `command` bez rozpoznané cesty by se měřila jen přes CMD — tedy
    // vůbec ne. Bez `command` běží CMD obrazu, a ten je ve VSTUPECH vždy.
    const nevidene = SLUZBY.filter((s) => s.maPrikaz && s.cesty.length === 0).map((s) => s.kde);
    expect(nevidene).toEqual([]);
  });

  it("detektor na ZNÁMÉM vstupu: statický, dynamický i require; vestavěné moduly ne", () => {
    const zdroj = [
      'import pg from "pg";',
      'import { readFileSync } from "node:fs";',
      'import path from "path";',
      'export { x } from "@scope/balik/podcesta";',
      'const z = await import("zod");',
      'const y = require("yaml");',
      'import { a } from "./lokalni.mjs";',
      "// import nic from \"komentar\";",
    ].join("\n");
    expect(holeBaliky(bezJsKomentaru(zdroj)).sort()).toEqual(["@scope/balik", "pg", "yaml", "zod"]);
    expect(spusteneCesty('node "${APP_DIR}/scripts/a.mjs"\nsource "$ROOT/scripts/lib/b.sh"\necho "spusť scripts/c.mjs"')).toEqual([
      "scripts/a.mjs",
      "scripts/lib/b.sh",
    ]);
  });

  it("sledovač dojde přes npm run, relativní import i `node` s cestou z join()", () => {
    // Známé hrany dnešního stromu: db:migrate → migrate.mjs → lib/psql-pripojeni.mjs;
    // compile-seed.mjs spouští seed.mjs přes path.join(__dirname, "seed.mjs").
    for (const soubor of ["scripts/db/migrate.mjs", "scripts/db/lib/psql-pripojeni.mjs", "scripts/db/seed.mjs"]) {
      expect(STOPA.soubory.has(soubor), soubor).toBe(true);
    }
    expect(STOPA.nedeklarovaneNpmRun).toEqual([]);
    expect(STOPA.nerozresene, "import, který měřidlo nedohledá, je slepé místo").toEqual([]);
  });

  it("⛔ skripty obrazu neimportují balík, který obraz nenese — a obraz nenese nic navíc", () => {
    const importovane = [...STOPA.hole].map(([b, kde]) => `${b} ← ${[...new Set(kde)].join(", ")}`).sort();
    const instalujeNpm = /\bnpm\s+(?:ci|install|i)\b/.test(bezShKomentaru(cti(DOCKERFILE)));
    // Obraz node_modules nenese. Zčervená-li `importovane`: nainstaluj do obrazu
    // JEN ty balíky (verze z package.json) a uprav tuhle bránu tak, aby měřila
    // instalovanou množinu. Zčervená-li `instalujeNpm`: obraz instaluje, co žádný
    // jeho skript nečte — právě ten gigabajt, kvůli kterému brána vznikla.
    // ⛔ Zpráva do POROVNÁVANÉ hodnoty, ne do druhého argumentu `expect`.
    expect({ importovane, npx: STOPA.npx, instalujeNpm }).toEqual({ importovane: [], npx: [], instalujeNpm: false });
  });
});
