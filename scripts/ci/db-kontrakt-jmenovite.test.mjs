import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { souboryZeSkriptu } from "./db-kontrakt-jmenovite.mjs";

const P = "node scripts/db/with-throwaway-db.mjs -- npx vitest run";
const vse = () => true;

describe("soubory jmenovaných DB sad se čtou z package.json", () => {
  it("sjednotí soubory sad v pořadí jmen a bez duplicit", () => {
    const scripts = {
      "test:db:a": `${P} src/tests/db/a.runtime.test.ts`,
      "test:db:b": `${P} src/tests/db/b.runtime.test.ts src/tests/db/a.runtime.test.ts`,
    };
    expect(souboryZeSkriptu(scripts, ["a", "b"], vse)).toEqual({
      soubory: ["src/tests/db/a.runtime.test.ts", "src/tests/db/b.runtime.test.ts"],
      chyby: [],
    });
  });

  it("neznámé jméno, cizí tvar i přepínač navíc jsou chyba, ne odhad", () => {
    const scripts = {
      "test:db:jiny": "npx vitest run src/tests/db/a.runtime.test.ts",
      "test:db:prepinac": `${P} --sequence.shuffle src/tests/db/a.runtime.test.ts`,
    };
    const { chyby } = souboryZeSkriptu(scripts, ["chybi", "jiny", "prepinac"], vse);
    expect(chyby).toHaveLength(3);
    expect(chyby[0]).toMatch(/test:db:chybi: v package.json není/);
    expect(chyby[1]).toMatch(/neznámý tvar/);
    expect(chyby[2]).toMatch(/--sequence\.shuffle/);
  });

  it("chybějící soubor a prázdný seznam jmen jsou chyba", () => {
    const scripts = { "test:db:a": `${P} src/tests/db/neni.runtime.test.ts` };
    expect(souboryZeSkriptu(scripts, ["a"], () => false).chyby[0]).toMatch(/neexistuje/);
    expect(souboryZeSkriptu(scripts, [], vse).chyby[0]).toMatch(/žádné jméno/);
  });

  it("volání v ci.yml se rozloží proti skutečnému package.json beze zbytku", () => {
    const ci = readFileSync(".forgejo/workflows/ci.yml", "utf8");
    const volani = ci.match(/node scripts\/ci\/db-kontrakt-jmenovite\.mjs ([^\n\\]+)/g) ?? [];
    expect(volani).toHaveLength(1);
    const jmena = volani[0].replace(/^node scripts\/ci\/db-kontrakt-jmenovite\.mjs /, "").trim().split(/\s+/);
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
    const { soubory, chyby } = souboryZeSkriptu(scripts, jmena, existsSync);
    expect(chyby).toEqual([]);
    expect(soubory.length).toBeGreaterThanOrEqual(jmena.length);
  });
});
