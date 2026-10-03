/**
 * Slovník instance — čím se v TÉHLE appce věci jmenují.
 *
 * ⛔ Slovník se načítá JEDNOU při importu (`extra` se za běhu nemění), takže
 * každý případ potřebuje čerstvý modul. `isolateModules` je ta cena za to, že
 * se při každém `t()` neprochází neznámý objekt znovu.
 */
const mockExtra: { AISHA_I18N_SLOVNIK?: unknown; AISHA_I18N_INSTANCE?: unknown } = {};
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: mockExtra }; } },
}));

// Jen TYP: `import type` mizí při překladu, takže modul nenačte a mock
// z `jest.mock` výše zůstává jediným načtením za běhu.
import type * as SlovnikModul from "@/config/slovnik";

type Slovnik = typeof SlovnikModul;

/**
 * Načte modul znovu nad daným obsahem `extra`.
 *
 * Týž vzor jako `brandInterpolation.test.ts` — `import()` tu nejde: běžec by
 * potřeboval `--experimental-vm-modules`, což je cena za jeden test.
 */
function sSlovnikem(hodnota: unknown): Slovnik {
  mockExtra.AISHA_I18N_SLOVNIK = hodnota;
  let m!: Slovnik;
  jest.isolateModules(() => {
    // require() je tu nevyhnutelné: isolateModules potřebuje čerstvé CJS načtení.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    m = require("@/config/slovnik") as Slovnik;
  });
  return m;
}

describe("bez slovníku", () => {
  it("build bez slovníku nic nepřepisuje", () => {
    const m = sSlovnikem(undefined);
    expect(m.maSlovnik()).toBe(false);
    expect(m.prepis("cs", "workflow.steps.title")).toBeUndefined();
  });
});

describe("přepis", () => {
  it("vrátí, co instance vyjmenovala", () => {
    const m = sSlovnikem({ cs: { "workflow.steps.title": "Moje dodávky" } });
    expect(m.prepis("cs", "workflow.steps.title")).toBe("Moje dodávky");
  });

  it("nevyjmenovaný klíč mlčí — slovník je částečný ze své podstaty", () => {
    const m = sSlovnikem({ cs: { "workflow.steps.title": "Moje dodávky" } });
    expect(m.prepis("cs", "workflow.steps.submit")).toBeUndefined();
  });

  it("⛔ NEPADÁ na jiný jazyk — anglická věta uprostřed české obrazovky je horší než původní český text", () => {
    const m = sSlovnikem({ en: { "workflow.steps.title": "My deliveries" } });
    expect(m.prepis("cs", "workflow.steps.title")).toBeUndefined();
    expect(m.prepis("en", "workflow.steps.title")).toBe("My deliveries");
  });
});

describe("poškozený obsah", () => {
  it.each([
    ["pole", [1, 2, 3]],
    ["řetězec", "nesmysl"],
    ["null", null],
  ])("%s = žádný slovník, ne pád", (_jmeno, vstup) => {
    const m = sSlovnikem(vstup);
    expect(m.maSlovnik()).toBe(false);
  });

  it("nepoužitelné hodnoty se přeskočí, použitelné zůstanou", () => {
    const m = sSlovnikem({ cs: { "a.b": 42, "c.d": "  ", "e.f": "Dodávka" } });
    expect(m.prepis("cs", "a.b")).toBeUndefined();
    expect(m.prepis("cs", "c.d")).toBeUndefined();
    expect(m.prepis("cs", "e.f")).toBe("Dodávka");
  });

  it("jazyk bez jediné použitelné věty se nepočítá", () => {
    const m = sSlovnikem({ cs: { "a.b": 42 } });
    expect(m.maSlovnik()).toBe(false);
  });
});

/** Načte modul znovu nad slovníkem INSTANCE (i18n.json → extra.AISHA_I18N_INSTANCE). */
function sInstanci(hodnota: unknown): Slovnik {
  mockExtra.AISHA_I18N_SLOVNIK = undefined;
  mockExtra.AISHA_I18N_INSTANCE = hodnota;
  let m!: Slovnik;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    m = require("@/config/slovnik") as Slovnik;
  });
  return m;
}

describe("slovník instance — klíče, které platforma nezná (2026-09-29)", () => {
  it("vrátí název bloku, který zná jen instance — místo surového klíče na pásce", () => {
    const m = sInstanci({ cs: { "block.vyvoz.handover": "Předání dnes" } });
    expect(m.doplnekInstance("cs", "block.vyvoz.handover")).toBe("Předání dnes");
  });

  it("jazyky se nemíchají — chybějící český klíč nevezme anglický text", () => {
    const m = sInstanci({ en: { "app.wf.field.where": "Where" } });
    expect(m.doplnekInstance("cs", "app.wf.field.where")).toBeUndefined();
    expect(m.doplnekInstance("en", "app.wf.field.where")).toBe("Where");
  });

  it("⛔ nesmysl v extra appku neshodí — prostě není co doplnit", () => {
    for (const vadne of [undefined, null, "text", ["cs"], { cs: "x" }, { cs: { k: 5 } }]) {
      const m = sInstanci(vadne);
      expect(m.doplnekInstance("cs", "k")).toBeUndefined();
    }
  });

  it("slovník instance NENÍ přepis — přepis (brand.slovnik) o něm nic neví", () => {
    const m = sInstanci({ cs: { "workflow.steps.title": "Něco jiného" } });
    expect(m.prepis("cs", "workflow.steps.title")).toBeUndefined();
    expect(m.maSlovnik()).toBe(false);
  });
});
