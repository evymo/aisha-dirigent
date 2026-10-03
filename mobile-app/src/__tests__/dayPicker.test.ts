/**
 * Výběr dne — datumová aritmetika, která se tiše plete.
 *
 * Všechny tři případy níž selhávají ZOBRAZENÍM ŠPATNÉHO DNE, ne výjimkou:
 * uživatel klepne na 3. a dostane data ze 2., a nemá jak poznat proč.
 */
import { isoDay, monthCells, dayParams } from "@/extranet/day";

describe("výběr dne", () => {
  it("⛔ datum je KALENDÁŘNÍ údaj, ne okamžik — nesmí přeskočit přes UTC", () => {
    // 3. 8. 2026 ve 23:30 lokálně. `toISOString()` by v našem pásmu vrátilo
    // už 4. srpna, takže by se dotaz zeptal na jiný den, než na který se kleplo.
    expect(isoDay(new Date(2026, 7, 3, 23, 30))).toBe("2026-08-03");
    // A totéž brzy ráno na druhou stranu.
    expect(isoDay(new Date(2026, 7, 3, 0, 15))).toBe("2026-08-03");
  });

  it("měsíc začíná ve správném sloupci (týden od pondělí)", () => {
    // 1. 8. 2026 je SOBOTA → pět prázdných políček (po–pá) před ní.
    const cells = monthCells(2026, 7);
    expect(cells.slice(0, 5).every((c) => c === null)).toBe(true);
    expect(cells[5]).not.toBeNull();
    expect(isoDay(cells[5] as Date)).toBe("2026-08-01");
  });

  it("mřížka je vždy celé týdny a obsahuje všechny dny měsíce", () => {
    for (const [y, m, days] of [[2026, 0, 31], [2026, 1, 28], [2024, 1, 29], [2026, 10, 30]] as const) {
      const cells = monthCells(y, m);
      expect(cells.length % 7).toBe(0);
      expect(cells.filter(Boolean)).toHaveLength(days);
    }
  });

  it("bez vybraného dne se NEPOSÍLÁ nic — blok si rozhoduje sám", () => {
    // Kdyby se posílalo prázdné okno, přebilo by konfiguraci bloku a řidičova
    // páska by přišla o svoje „dnešek a okolí".
    expect(dayParams(null)).toBeUndefined();
  });

  it("s vybraným dnem jde s ním i `status: any`", () => {
    // Bez toho by každý MINULÝ den vrátil prázdno (výchozí filtr je 'pending').
    expect(dayParams("2026-08-03")).toEqual({
      date_from: "2026-08-03",
      date_to: "2026-08-03",
      status: "any",
    });
  });
});
