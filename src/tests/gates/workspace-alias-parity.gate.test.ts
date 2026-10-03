/**
 * Brána: každý workspace balíček, který importuje SPA, musí mít alias.
 *
 * ⛔ NAMĚŘENO 2026-08-30 — dvě selhaná nasazení a čtyřicet minut hledání.
 * `@aisha/web-canvas` se do `src/` importoval, ale nedostal alias ve
 * `vite.config.ts` ani `paths` v `tsconfig.app.json`. Lokálně to prošlo,
 * protože `npm install` vyrobil symlink `node_modules/@aisha/web-canvas`.
 * V obrazu ale `npm ci` běží DŘÍV, než se nakopíruje `packages/`, takže
 * symlink nevznikne — a build spadl až v nasazení na
 * „Rollup failed to resolve import".
 *
 * To je nejhorší tvar vady: zelená na stroji, červená v produkci, a příčina
 * o tři vrstvy jinde než příznak. Brána ji převádí na okamžité, lokální
 * selhání s návodem.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

/**
 * Balíčky `@aisha/*` importované ze zdrojů SPA.
 *
 * ⛔ TESTY SE VYNECHÁVAJÍ, a není to úlitba. Vitest si zdroje rozlišuje sám
 * přes node_modules, do buildu SPA nejdou — hlásit je by znamenalo trvale
 * dva nálezy, které nic nerozbijí (naměřeno: `@aisha/surface-blocks`
 * a `@aisha/workbench-core` žijí výhradně v testech). Brána, která hlásí
 * neškodné věci, se přestane číst, a pak nezachytí ani tu škodlivou.
 */
function importovaneBalicky(): string[] {
  const nalezene = new Set<string>();
  const projdi = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "tests") continue;
        projdi(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
        const text = fs.readFileSync(p, "utf8");
        for (const m of text.matchAll(/from\s+["'](@aisha\/[a-z0-9-]+)["']/g)) {
          nalezene.add(m[1]);
        }
      }
    }
  };
  projdi(path.join(ROOT, "src"));
  return [...nalezene].sort();
}

describe("workspace balíčky v SPA mají alias", () => {
  const balicky = importovaneBalicky();

  it("sonda vidí importy (mlčení je samo nálezem)", () => {
    // Kdyby se změnil tvar zdrojáků nebo sken přestal procházet soubory,
    // testy níž by prošly nad prázdnem a brána by tiše nehlídala nic.
    expect(balicky.length).toBeGreaterThan(0);
  });

  it("každý má alias ve vite.config.ts", () => {
    const vite = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    const chybi = balicky.filter((b) => !vite.includes(`"${b}"`));
    expect(
      chybi,
      "Balíček se importuje v src/, ale nemá alias ve vite.config.ts. " +
        "V obrazu neexistuje symlink v node_modules (npm ci běží před COPY packages/), " +
        "takže rollup import nerozřeší a nasazení spadne — lokálně přitom projde. " +
        'Náprava: přidat `"<balíček>": path.resolve(__dirname, "./packages/<jméno>/src/index.ts")`.',
    ).toEqual([]);
  });

  it("každý má paths v tsconfig.app.json", () => {
    const ts = fs.readFileSync(path.join(ROOT, "tsconfig.app.json"), "utf8");
    const chybi = balicky.filter((b) => !ts.includes(`"${b}"`));
    expect(
      chybi,
      "Balíček se importuje v src/, ale nemá `paths` v tsconfig.app.json — " +
        "typová kontrola by ho hledala přes node_modules, tedy jinou cestou než build.",
    ).toEqual([]);
  });
});
