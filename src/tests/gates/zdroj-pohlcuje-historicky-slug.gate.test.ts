/**
 * Sjednocení identity zdroje: aktivní zdroj smí POHLTIT historický slug
 *
 * ⛔ NAMĚŘENO 2026-09-02 V PROVOZU. Engine značí balíčky `local-ingest`, ale TŘI
 * balíčky ze 3.–4. 8. nesou `aisha-local-ingest` — jméno APLIKACE, ne
 * registrovaného zdroje. Jednorázová anomálie jednoho exportního běhu; poznat
 * ji lze i podle odlišného tvaru `export_id` (bez časové zóny, kterou mají
 * všechny ostatní).
 *
 * Ta tři jména založila NÁVRH, který se bez 4D klasifikace nedá aktivovat, a od
 * té doby blokují každý běh:
 *
 *     total_syncs = 1435   failures = 1435   last_success_at = NULL
 *
 * Jedna skutečnost tak měla DVĚ identity a obě se tvářily jako samostatný zdroj.
 *
 * ⭐ PROČ POHLCENÍ, A NE JINÁ CESTA
 *   · přejmenovat slug v balíčcích nejde — jsou podepsané a už odeslané;
 *   · klasifikovat druhý zdroj by duplicitu ZABETONOVALO;
 *   · uhodnout, že dvě jména znamenají totéž, stroj NESMÍ — je to tvrzení
 *     o světě, ne o datech. Proto je pohlcení KURÁTOROVANÉ: zapisuje ho člověk
 *     přes `set_data_source_config` do `config.nahrazuje`.
 *
 * INVARIANT: `ensure_source_story` musí historický slug resolvovat na pohlcující
 * zdroj — a to bez `FOUND`, protože ten přepíše každý další příkaz.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN = join(ROOT, "aisha", "db", "sql", "functions", "ensure_source_story.sql");

describe("zdroj pohlcuje historický slug", () => {
  const src = existsSync(FN) ? readFileSync(FN, "utf8") : "";

  test("soubor funkce se vůbec našel — jinak brána měří prázdno", () => {
    expect(src.length).toBeGreaterThan(400);
  });

  test("pohlcení se hledá v `config.nahrazuje` AKTIVNÍHO zdroje", () => {
    expect(
      src,
      "Bez tohohle kroku má jedna skutečnost dvě identity a balíčky s historickým\n" +
        "slugem uvíznou v karanténě napořád.",
    ).toMatch(/is_active\s+AND\s+\(config\s*->\s*'nahrazuje'\)\s*\?\s*p_source_slug/);
  });

  test("⛔ rozhodnutí NESMÍ viset na `FOUND` — přepíše ho každý další příkaz", () => {
    // UPDATE i INSERT do auditu `FOUND` přepíšou, takže „zdroj mám" by záviselo
    // na tom, kolik řádků se právě dotklo auditu. Odpověď drží vlastní příznak.
    expect(src).toMatch(/v_mam\s+boolean/);
    const telo = src.slice(src.indexOf("BEGIN"));
    expect(
      telo.match(/IF NOT FOUND THEN/g) ?? [],
      "Ve větvení zůstal `IF NOT FOUND` — po UPDATE/INSERT už neříká, co si autor myslí.",
    ).toEqual([]);
  });

  test("pohlcený návrh se OZNAČÍ — jinak ho administrace ukazuje dál jako čekající", () => {
    expect(src).toMatch(/superseded_by/);
  });

  test("pohlcení nechává STOPU v auditu", () => {
    expect(src).toMatch(/ingest\.source\.absorbed/);
  });

  test("funkce je v heals — jinak se na existující databázi NENASADÍ", () => {
    const heals = readFileSync(join(ROOT, "aisha", "db", "heals.sql"), "utf8");
    expect(heals).toMatch(/ensure_source_story\.sql/);
  });
});
