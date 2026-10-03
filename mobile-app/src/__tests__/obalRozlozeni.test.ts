/**
 * Obal obrazovky master–detail má VŽDY výšku.
 *
 * NAMĚŘENO 2026-09-30 (tablet na výšku ≈ 601 dp, Řidič 1.2.0): obal detailu kroku
 * bez stylu přerušil řetěz flex, ScrollView dostal výšku 0 a obrazovka byla prázdná —
 * ani hlavička, žádná chyba v logu. Týkalo se každého telefonu (vždy pod prahem).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { obalRozlozeni } from "@/lib/rozlozeni";

describe("obal rozložení", () => {
  it("⛔ jeden sloupec má flex 1 — jinak ScrollView dostane výšku 0 a obrazovka je prázdná", () => {
    expect(obalRozlozeni(false)).toEqual({ flex: 1 });
  });

  it("dvousloupec je řádek přes celou plochu", () => {
    expect(obalRozlozeni(true)).toEqual({ flex: 1, flexDirection: "row" });
  });

  it("detail kroku bere obal z obalRozlozeni — žádný podmíněný styl s undefined", () => {
    const src = readFileSync(join(__dirname, "..", "app", "kroky.tsx"), "utf8");
    expect(src).not.toMatch(/dvousloupec \? styles\.[A-Za-z]+ : undefined/);
    expect(src).toMatch(/style=\{obalRozlozeni\(dvousloupec\)\}/);
  });
});
