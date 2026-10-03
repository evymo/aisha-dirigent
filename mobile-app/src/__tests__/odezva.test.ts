/**
 * Odezva — měří se ROZDÍL, ne existence.
 *
 * ⛔ Nejdůležitější tvrzení: „odesláno" a „uloženo do fronty" se NESMÍ cítit
 * stejně. Kdyby ano, člověk odjede od rampy s dojmem, že práce je na serveru.
 */
import { druhOdezvy, type Povaha } from "@/lib/odezva";

describe("rozlišení výsledků", () => {
  it("⛔ hotovo a fronta mají RŮZNOU odezvu", () => {
    expect(druhOdezvy("hotovo")).not.toBe(druhOdezvy("fronta"));
  });

  it("⛔ fronta se necítí jako úspěch — uloženo není odesláno", () => {
    expect(druhOdezvy("fronta")).not.toBe("uspech");
  });

  it("každá povaha má vlastní druh — žádné dvě nesplývají", () => {
    const vsechny: Povaha[] = ["hotovo", "fronta", "pozor", "chyba"];
    const druhy = vsechny.map(druhOdezvy);
    expect(new Set(druhy).size).toBe(vsechny.length);
  });
});

describe("povahy", () => {
  it.each([
    ["hotovo", "uspech"],
    ["fronta", "naraz"],
    ["pozor", "varovani"],
    ["chyba", "chyba"],
  ] as const)("%s → %s", (p, d) => {
    expect(druhOdezvy(p)).toBe(d);
  });
});
