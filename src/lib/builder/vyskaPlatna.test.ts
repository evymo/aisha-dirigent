import { describe, expect, it } from "vitest";
import { spoctiVyskuPlatna } from "./vyskaPlatna";

describe("spoctiVyskuPlatna — výška podle viditelné plochy, ne konstanty", () => {
  it("naměřené okno 1470×437: plátno pod hlavičkou by mělo 84 px → editor vyplní celé okno", () => {
    // 2026-09-14 produkce: editor (lišta) začínal na 191 px, plátno na 329 px, main p-6 = 24 px.
    const r = spoctiVyskuPlatna({ vyskaOkna: 437, horniOkrajPlatna: 329, horniOkrajEditoru: 191, spodniOdsazeni: 24 });
    expect(r.rezim).toBe("editor-pres-okno");
    expect(r.vyska).toBe(437 - (329 - 191) - 24); // 275 px — nikdy továrních 150
  });

  it("vysoký display: plátno se vejde pod hlavičku a zabere zbytek okna", () => {
    const r = spoctiVyskuPlatna({ vyskaOkna: 1300, horniOkrajPlatna: 329, horniOkrajEditoru: 191, spodniOdsazeni: 24 });
    expect(r).toEqual({ vyska: 1300 - 329 - 24, rezim: "pod-hlavickou" });
  });

  it("stejné rozložení na různých displejích dává různou výšku — žádná pevná hodnota", () => {
    const vysky = [600, 900, 1200, 1600].map((vyskaOkna) =>
      spoctiVyskuPlatna({ vyskaOkna, horniOkrajPlatna: 329, horniOkrajEditoru: 191, spodniOdsazeni: 24 }).vyska);
    expect(new Set(vysky).size).toBe(vysky.length);
    for (let i = 1; i < vysky.length; i++) expect(vysky[i]).toBeGreaterThan(vysky[i - 1]);
  });

  it("hranice: právě polovina okna pod hlavičkou ještě nechá hlavičku vidět", () => {
    const r = spoctiVyskuPlatna({ vyskaOkna: 1000, horniOkrajPlatna: 500, horniOkrajEditoru: 400, spodniOdsazeni: 0 });
    expect(r).toEqual({ vyska: 500, rezim: "pod-hlavickou" });
  });

  it("nesmyslně malé okno nevrátí zápornou výšku", () => {
    const r = spoctiVyskuPlatna({ vyskaOkna: 100, horniOkrajPlatna: 329, horniOkrajEditoru: 191, spodniOdsazeni: 24 });
    expect(r.vyska).toBe(0);
  });
});
