import { describe, it, expect } from "vitest";
import { citelnyStitek, normalizujStitek, popisekStitku } from "@/lib/novinky/stitky";

describe("normalizace štítku", () => {
  it("trim, malá písmena, mezery na pomlčky", () => {
    expect(normalizujStitek("  Vajra Family ")).toBe("vajra-family");
    expect(normalizujStitek("vajra-family")).toBe("vajra-family");
  });
  it("diakritika zůstává, interpunkce jde pryč, délka je omezená", () => {
    expect(normalizujStitek("Praha, jaro!")).toBe("praha-jaro");
    expect(normalizujStitek("x".repeat(60))).toHaveLength(40);
    expect(normalizujStitek("čaj & zen")).toBe("čaj--zen");
  });
});

describe("čitelný název štítku (zobrazení na webu)", () => {
  it("syrová hodnota → čitelný název; opak normalizace", () => {
    expect(citelnyStitek("people")).toBe("People");
    expect(citelnyStitek("wisdom-quotes")).toBe("Wisdom quotes");
    expect(citelnyStitek("snake_case--tag")).toBe("Snake case tag");
    expect(citelnyStitek(normalizujStitek("Wisdom quotes"))).toBe("Wisdom quotes");
  });
  it("překlad z administrace má přednost, prázdný překlad ne", () => {
    expect(popisekStitku("people", { people: "Lidé" })).toBe("Lidé");
    expect(popisekStitku("people", { people: "  " })).toBe("People");
    expect(popisekStitku("channels", {})).toBe("Channels");
  });
});
