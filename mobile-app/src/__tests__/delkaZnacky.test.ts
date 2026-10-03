/**
 * Podpis, nebo jen dotek?
 *
 * ⛔ NAMĚŘENO 2026-08-20: jediné klepnutí vyrobilo platnou cestu (`M 100 50`),
 * takže „Hotovo" se rozsvítilo a odešlo předání se značkou, která neznamená
 * nic. Zjistí se to při reklamaci — tedy přesně tehdy, kdy je podpis to jediné,
 * oč jde.
 */
import { MIN_ZNACKA_DP, delkaZnacky, jeToPodpis } from "@/lib/signature";

/** Vodorovná čára délky `n` — tvar, který vyrábí `SignaturePad`. */
const cara = (n: number) => `M 0 0 L ${n} 0`;

describe("délka značky", () => {
  it("sečte dráhu uvnitř tahu", () => {
    expect(delkaZnacky([cara(100)])).toBeCloseTo(100);
  });

  it("⛔ sečte VŠECHNY tahy — podpis se skládá z víc než jednoho", () => {
    expect(delkaZnacky([cara(40), cara(40)])).toBeCloseTo(80);
  });

  it("⛔ mezi tahy se dráha NEPOČÍTÁ — zvednutí prstu není čára", () => {
    // Kdyby se počítal skok z konce jednoho tahu na začátek druhého, dvě tečky
    // daleko od sebe by prošly jako podpis.
    expect(delkaZnacky(["M 0 0", "M 500 500"])).toBe(0);
  });

  it("úhlopříčka se měří skutečnou vzdáleností, ne součtem os", () => {
    expect(delkaZnacky(["M 0 0 L 30 40"])).toBeCloseTo(50);
  });

  it("desetinná čísla a záporné souřadnice", () => {
    expect(delkaZnacky(["M -10.5 0 L 9.5 0"])).toBeCloseTo(20);
  });

  it("⛔ neznámý tvar vrací NULU, ne odhad", () => {
    expect(delkaZnacky(["nesmysl"])).toBe(0);
    expect(delkaZnacky([""])).toBe(0);
    expect(delkaZnacky([])).toBe(0);
  });
});

describe("je to podpis", () => {
  it("⛔ jediný dotek NENÍ podpis", () => {
    expect(jeToPodpis(["M 100 50"])).toBe(false);
  });

  it("⛔ ani hrst teček — značka jen z teček je pořád jen dotýkání", () => {
    expect(jeToPodpis(["M 10 10", "M 20 20", "M 30 30", "M 40 40"])).toBe(false);
  });

  it("⭐ tečka UVNITŘ podpisu ho nezneplatní — háček a tečka nad i jsou legitimní", () => {
    expect(jeToPodpis([cara(MIN_ZNACKA_DP), "M 5 5"])).toBe(true);
  });

  it("běžný podpis projde", () => {
    expect(jeToPodpis([cara(200), cara(90)])).toBe(true);
  });

  it("hranice drží z obou stran", () => {
    expect(jeToPodpis([cara(MIN_ZNACKA_DP)])).toBe(true);
    expect(jeToPodpis([cara(MIN_ZNACKA_DP - 1)])).toBe(false);
  });
});
