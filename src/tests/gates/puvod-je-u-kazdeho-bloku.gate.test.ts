/**
 * Každý blok povrchu vydává svůj PŮVOD.
 *
 * ⛔ NAMĚŘENO 2026-08-31: dvanáct ze třinácti blokových rendererů kreslilo
 * `<Provenance block={block} />`. Třináctý — `handover_confirm` — ne, a přitom
 * je to právě ten, který vydává NAMĚŘENOU hodnotu (`Es.Measure`) a doklady.
 * Zákon jazyka 02 („žádné číslo bez zdroje") tam tedy chyběl nejcitelněji:
 * potvrzení předání se podepisuje, a podepsat se dá jen to, u čeho je vidět,
 * odkud to je.
 *
 * ⭐ PROČ TO NIKDO NEVIDĚL: chybějící původ nic nerozbije. Blok se vykreslí,
 * čísla tam jsou, jen se nedá zjistit, čí jsou. Vada, která se projeví až tím,
 * že se někdo zeptá „odkud to máte?" — a to je otázka, která přijde po podpisu.
 *
 * Univerzum si brána HLEDÁ: každá funkce, která bere `{ block: … }`, je
 * renderer. Nový blok se pod ni tedy dostane bez zásahu.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOUBOR = join(process.cwd(), "apps/workbench-shell/src/components/blocks.tsx");

/** Renderery bloků = funkce s parametrem `{ block: <Typ> }`. */
function renderery(src: string): { jmeno: string; telo: string }[] {
  const out: { jmeno: string; telo: string }[] = [];
  const re = /^function ([A-Z][A-Za-z0-9]*)\(\{ block[^)]*\}: \{ block: [A-Za-z]+ \}[^{]*\{/gm;
  for (const m of src.matchAll(re)) {
    const start = m.index!;
    // Tělo končí na prvním `\n}` ve sloupci 0 — soubor je formátovaný prettierem.
    const konec = src.indexOf("\n}", start);
    out.push({ jmeno: m[1], telo: src.slice(start, konec === -1 ? undefined : konec) });
  }
  return out;
}

describe("původ je u každého bloku povrchu", () => {
  const src = readFileSync(SOUBOR, "utf8");
  const bloky = renderery(src);

  test("měřidlo má co měřit — rendererů je aspoň deset", () => {
    // Bez tohohle by regrese v regexu udělala z prázdné množiny zelenou zprávu.
    expect(bloky.length, "nenašel jsem blokové renderery — regex se rozešel se souborem").toBeGreaterThanOrEqual(10);
  });

  test("⭐ každý renderer bloku vydává původ", () => {
    // `Provenance` je sama tím vydavatelem — vydávat sebe sama nedává smysl.
    // Vyloučení je JMENOVITÉ a s důvodem; tichý filtr by tu uměl schovat i blok.
    const bezPuvodu = bloky
      .filter((b) => b.jmeno !== "Provenance")
      .filter((b) => !/<Provenance block=\{block\} \/>/.test(b.telo))
      .map((b) => b.jmeno);
    expect(bezPuvodu, `Blok bez původu — čísla bez zdroje (zákon jazyka 02): ${bezPuvodu.join(", ")}`).toEqual([]);
  });
});
