import { describe, expect, it } from "vitest";
import { hslNaHex, rozmisteni, STRANA_IKONY } from "@/lib/media/slozeniIkony";

describe("složení ikony — čisté výpočty", () => {
  it("barva profilu (HSL bez obalu) → #rrggbb pro výběr barvy", () => {
    expect(hslNaHex("0 100% 50%")).toBe("#ff0000");
    expect(hslNaHex("120 100% 25%")).toBe("#008000");
    expect(hslNaHex("0 0% 100%")).toBe("#ffffff");
    // ukázková modrá: 213 82% 50% → rgb(23,117,232) (přepočteno ručně)
    expect(hslNaHex("213 82% 50%")).toBe("#1775e8");
  });

  it("nečitelná barva → null (volající dá výchozí)", () => {
    expect(hslNaHex("")).toBeNull();
    expect(hslNaHex("#1774e6")).toBeNull();
    expect(hslNaHex(undefined)).toBeNull();
    expect(hslNaHex("213 % 50%")).toBeNull();
    expect(hslNaHex("213 82 50%")).toBeNull();
    expect(hslNaHex("213 -5% 50%")).toBeNull();
  });

  it("čtvercový obrázek v kruhu se vejde do kruhu a je vystředěný", () => {
    const m = rozmisteni(100, 100, STRANA_IKONY, { tvar: "kruh", okraj: 0.1 });
    const plocha = (STRANA_IKONY / Math.SQRT2) * 0.8;
    expect(m.w).toBeCloseTo(plocha, 5);
    expect(m.h).toBeCloseTo(plocha, 5);
    expect(m.x).toBeCloseTo((STRANA_IKONY - plocha) / 2, 5);
    // roh vepsaného čtverce leží uvnitř kruhu
    const r = STRANA_IKONY / 2;
    expect(Math.hypot(m.x - r, m.y - r)).toBeLessThan(r);
  });

  it("široké logo zachová poměr stran a vystředí se svisle", () => {
    const m = rozmisteni(504, 90, STRANA_IKONY, { tvar: "zadne", okraj: 0 });
    expect(m.w).toBeCloseTo(STRANA_IKONY, 5);
    expect(m.h / m.w).toBeCloseTo(90 / 504, 5);
    expect(m.y).toBeCloseTo((STRANA_IKONY - m.h) / 2, 5);
  });

  it("okraj se drží v mezích 0–0,4", () => {
    const bez = rozmisteni(100, 100, STRANA_IKONY, { tvar: "ctverec", okraj: -1 });
    const max = rozmisteni(100, 100, STRANA_IKONY, { tvar: "ctverec", okraj: 9 });
    expect(bez.w).toBeCloseTo(STRANA_IKONY, 5);
    expect(max.w).toBeCloseTo(STRANA_IKONY * 0.2, 5);
  });
});
