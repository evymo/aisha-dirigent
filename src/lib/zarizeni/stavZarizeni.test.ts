import { describe, expect, it } from "vitest";
import { TICHO_MS, celkem, mlci, stavBalicku } from "./stavZarizeni";

describe("stav instalace na tabletu", () => {
  it("nainstalováno aspoň v cílové verzi = aktuální, nižší = starší, -1 nebo nic = chybí", () => {
    expect(stavBalicku(15, 15)).toBe("aktualni");
    expect(stavBalicku(16, 15)).toBe("aktualni");
    expect(stavBalicku(14, 15)).toBe("starsi");
    expect(stavBalicku(-1, 15)).toBe("chybi");
    expect(stavBalicku(undefined, 15)).toBe("chybi");
  });

  it("celkový stav je nejhorší z balíčků", () => {
    expect(celkem(["aktualni", "starsi"])).toBe("starsi");
    expect(celkem(["aktualni", "chybi", "starsi"])).toBe("chybi");
    expect(celkem([])).toBe("aktualni");
  });

  it("tablet, který se dlouho neozval, se označí — i s nečitelným časem", () => {
    const ted = new Date("2026-09-28T12:00:00Z");
    expect(mlci("2026-09-28T02:00:00Z", ted)).toBe(false);
    expect(mlci(new Date(ted.getTime() - TICHO_MS - 1).toISOString(), ted)).toBe(true);
    expect(mlci("nesmysl", ted)).toBe(true);
  });
});
