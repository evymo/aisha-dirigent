/**
 * Skripty řadí texty NEZÁVISLE na LANG stroje
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * V `scripts/` nesmí být `localeCompare(` bez zadané locale (ani s `undefined`).
 * Jeden domov řazení je `scripts/lib/razeni.mjs` → `porovnej(a, b)`.
 *
 * ── PROČ (naměřeno 2026-09-24, riq main 9cd998f0d) ────────────────────────────
 * `a.localeCompare(b)` bere locale z prostředí. CI běží pod C (Node → en-US),
 * vývojáři pod cs_CZ, kde je „ch" samostatné písmeno za „h". `npm run regen`:
 *
 *     LC_ALL=C            →  0 diff
 *     LC_ALL=cs_CZ.UTF-8  →  7 artefaktů, 3 128 řádků přeřazeno
 *                            (baseline 5 450 ř., seed.compiled, seed, 3× překlady, baseline-meta)
 *
 * Kontroly driftu i pre-push pak pod češtinou hlásily „drift", který ve zdroji
 * nebyl — a dalo se to jen obejít (LC_ALL=…), ne opravit. 46 volání ve 26
 * souborech, ani jedno s locale.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { porovnej } from "../../../scripts/lib/razeni.mjs";

const ROOT = process.cwd();
const PRIPONY = /\.(mjs|cjs|js|ts)$/;

/** Soubory skriptů ze SOUBOROVÉHO SYSTÉMU (ne `git ls-files` — ten nevidí nový nestagovaný soubor). */
function soubory(adresar: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(adresar, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    const p = path.join(adresar, e.name);
    if (e.isDirectory()) out.push(...soubory(p));
    else if (PRIPONY.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

/** Komentáře pryč — zmínka o `localeCompare(` v dokumentaci není volání. */
function bezKomentaru(zdroj: string): string {
  return zdroj
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

type Nalez = { radek: number; text: string };

/** Volání `localeCompare(` bez druhého argumentu, nebo s `undefined` místo locale. */
export function bezLocale(zdroj: string): Nalez[] {
  const s = bezKomentaru(zdroj);
  const out: Nalez[] = [];
  const TOK = "localeCompare(";
  for (let j = s.indexOf(TOK); j >= 0; j = s.indexOf(TOK, j + 1)) {
    const args: string[] = [""];
    let hloubka = 1;
    let q: string | null = null;
    for (let i = j + TOK.length; i < s.length && hloubka > 0; i++) {
      const c = s[i];
      if (q) {
        if (c === "\\") { args[args.length - 1] += c + s[++i]; continue; }
        if (c === q) q = null;
      } else if (c === "'" || c === '"' || c === "`") q = c;
      else if ("([{".includes(c)) hloubka++;
      else if (")]}".includes(c) && --hloubka === 0) break;
      else if (c === "," && hloubka === 1) { args.push(""); continue; }
      args[args.length - 1] += c;
    }
    const locale = args[1]?.trim();
    if (!locale || locale === "undefined") {
      const radek = s.slice(0, j).split("\n").length;
      out.push({ radek, text: zdroj.split("\n")[radek - 1].trim() });
    }
  }
  return out;
}

describe("řazení ve skriptech nezávisí na LANG stroje", () => {
  it("⭐ v scripts/ není localeCompare( bez locale", () => {
    const nalezy = soubory(path.join(ROOT, "scripts")).flatMap((f) =>
      bezLocale(readFileSync(f, "utf8")).map((n) => `${path.relative(ROOT, f)}:${n.radek}  ${n.text}`),
    );
    expect(
      nalezy,
      "Řaď přes `porovnej` ze scripts/lib/razeni.mjs — bez locale výsledek závisí na LANG stroje",
    ).toEqual([]);
  });

  it("sonda umí říct NE: holé volání, složený příjemce i `undefined` jsou nález", () => {
    expect(bezLocale("x.sort((a, b) => a.localeCompare(b))")).toHaveLength(1);
    expect(bezLocale("(a.c || '').localeCompare(b.c || '')")).toHaveLength(1);
    expect(bezLocale("a.localeCompare(b, undefined, { numeric: true })")).toHaveLength(1);
    expect(bezLocale("a.k.localeCompare(b.k) || a.l.localeCompare(fn(b.l, 'x'))")).toHaveLength(2);
  });

  it("kontrolní vzorek: s locale a zmínka v komentáři projdou", () => {
    expect(bezLocale("a.localeCompare(b, 'en')")).toEqual([]);
    expect(bezLocale("a.localeCompare(b, \"cs\", { numeric: true })")).toEqual([]);
    expect(bezLocale("// a.localeCompare(b) řadí podle LANG\n/* x.localeCompare(y) */")).toEqual([]);
    expect(bezLocale("const url = 'https://x'; a.localeCompare(b, 'en')")).toEqual([]);
  });

  it("⭐ porovnej řadí jako CI (en), ne česky — i když proces běží pod cs_CZ", () => {
    // Česky by „hrad" předběhl „chata" (ch je za h). Tohle je přesně ten rozdíl,
    // který přeřadil 3 128 řádků artefaktů.
    const slova = ["hrad", "chata", "Zeta", "ab", "Ab", "_x", "čáp", "cap"];
    expect([...slova].sort(porovnej)).toEqual(["_x", "ab", "Ab", "cap", "čáp", "chata", "hrad", "Zeta"]);
    expect([...slova].sort(porovnej)).toEqual([...slova].sort((a, b) => a.localeCompare(b, "en")));
  });
});
