import { describe, it, expect } from "vitest";
import { normalizujStitek } from "@/lib/novinky/stitky";

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
