/**
 * Profil buildu — „která ČÁST appky je v téhle appce".
 *
 * Zadání majitele (2026-08-19): *„umožnit ‚část' stávající appky vydat jako
 * exkluzivní appku pro nějaký účel — stejně tak může být miniappka jen pro sběr
 * stavů měřáků energií. Potřebujeme mít ale jednotné místo pravdy, ať
 * neudržujeme duplikovaný kód."*
 *
 * Tahle sada drží obě poloviny toho místa pravdy:
 *   · co je v TÉHLE appce  → data profilu (§1–§3)
 *   · co JDE do appky dát  → ODVOZENÉ ze souborů rout (§4 = brána)
 */
import fs from "node:fs";
import path from "node:path";
import { appSections, appTabs, applyProfile, isDedicated } from "@/config/profile";
import { TABS, visibleTabs } from "@/app/(tabs)/registry";

const mockExtra: { AISHA_APP_SECTIONS?: unknown; AISHA_APP_TABS?: unknown } = {};
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: mockExtra }; } },
}));

const sekce = (section: string) => ({ section, state: "active" as const });

beforeEach(() => {
  delete mockExtra.AISHA_APP_SECTIONS;
  delete mockExtra.AISHA_APP_TABS;
});

describe("§1 deštníkový build — bez profilu se nic nezužuje", () => {
  it("appSections/appTabs mlčí a build není dedikovaný", () => {
    expect(appSections()).toBeNull();
    expect(appTabs()).toBeNull();
    expect(isDedicated()).toBe(false);
  });

  it("applyProfile propustí, co server vydal, a nic nehlásí", () => {
    const granted = [sekce("prehled"), sekce("vyvoz"), sekce("meridla")];
    const { sections, unmatched } = applyProfile(granted);
    expect(sections).toEqual(granted);
    expect(unmatched).toEqual([]);
  });

  it("visibleTabs bez profilu ukáže všechny taby", () => {
    expect(visibleTabs(TABS, null)).toEqual(TABS.map((t) => t.name));
  });
});

describe("§2 dedikovaný build — appka řidiče a miniappka na odečty", () => {
  it("appka řidiče vidí jen vyvoz, i když server vydal víc", () => {
    mockExtra.AISHA_APP_SECTIONS = ["vyvoz"];
    const { sections, unmatched } = applyProfile([sekce("prehled"), sekce("vyvoz"), sekce("meridla")]);
    expect(sections.map((s) => s.section)).toEqual(["vyvoz"]);
    expect(unmatched).toEqual([]);
    expect(isDedicated()).toBe(true);
  });

  /** Táž appka, jiná data — o tom celý mechanismus je. */
  it("miniappka na odečty je TÝŽ kód s jiným slovem v profilu", () => {
    mockExtra.AISHA_APP_SECTIONS = ["meridla"];
    const { sections } = applyProfile([sekce("prehled"), sekce("vyvoz"), sekce("meridla")]);
    expect(sections.map((s) => s.section)).toEqual(["meridla"]);
  });

  it("zachovává POŘADÍ SERVERU — pořadí sekcí je samo informace", () => {
    mockExtra.AISHA_APP_SECTIONS = ["meridla", "vyvoz"];
    const { sections } = applyProfile([sekce("vyvoz"), sekce("meridla")]);
    expect(sections.map((s) => s.section)).toEqual(["vyvoz", "meridla"]);
  });

  it("profil zužuje, NIKDY nerozšiřuje — nárok rozhoduje server", () => {
    mockExtra.AISHA_APP_SECTIONS = ["vyvoz", "prehled"];
    const { sections } = applyProfile([sekce("vyvoz")]);
    expect(sections.map((s) => s.section)).toEqual(["vyvoz"]);
  });

  it("prázdný seznam je TÁŽ VĚC jako chybějící klíč, ne appka bez obsahu", () => {
    mockExtra.AISHA_APP_SECTIONS = [];
    expect(appSections()).toBeNull();
    expect(isDedicated()).toBe(false);
  });
});

describe("§3 sonda musí umět odpovědět ne", () => {
  /**
   * ⛔ TENHLE TEST VZNIKL Z VLASTNÍ VADY (2026-08-19). První verze
   * `applyProfile` při nulové shodě tiše propustila všechny sekce — „ať appka
   * není prázdná". Překlep v profilu by tak vyrobil appku, která vypadá hotově
   * a ukazuje CIZÍ sekci. Tichý rozumný default je horší než chybějící vstup:
   * nevynutí si pozornost.
   */
  it("překlep v profilu se VYSLOVÍ, ne spolkne", () => {
    mockExtra.AISHA_APP_SECTIONS = ["vyvozz"];
    const { sections, unmatched } = applyProfile([sekce("vyvoz")]);
    expect(sections).toEqual([]);
    expect(unmatched).toEqual(["vyvozz"]);
  });

  it("sekce, na kterou člověk nemá nárok, se pozná stejně", () => {
    mockExtra.AISHA_APP_SECTIONS = ["vyvoz"];
    const { sections, unmatched } = applyProfile([]);
    expect(sections).toEqual([]);
    expect(unmatched).toEqual(["vyvoz"]);
  });

  it("nesmyslně typovaný profil se čte jako žádný, ne jako prázdný", () => {
    mockExtra.AISHA_APP_SECTIONS = "vyvoz";
    expect(appSections()).toBeNull();
    mockExtra.AISHA_APP_SECTIONS = [42, "", "   "];
    expect(appSections()).toBeNull();
  });

  it("slugy se ořezávají — mezera nesmí vyrobit jinou sekci", () => {
    mockExtra.AISHA_APP_SECTIONS = ["  vyvoz  "];
    expect(appSections()).toEqual(["vyvoz"]);
  });
});

describe("§4 BRÁNA: univerzum tabů se ODVOZUJE ze souborů, nevypisuje", () => {
  /**
   * ⭐ Brána si univerzum HLEDÁ. Ručně vedený druhý seznam vedle skutečnosti je
   * ta vada, co v tomhle repu položila `BlockRenderer` — sedm typů kreslilo
   * obsah a pod ním hlásilo „neznámý typ", protože seznam „známých" žil vedle
   * skutečných větví a rozešel se s nimi.
   */
  const routeFiles = fs
    .readdirSync(path.join(__dirname, "..", "app", "(tabs)"))
    .filter((f) => /\.tsx$/.test(f))
    .map((f) => f.replace(/\.tsx$/, ""))
    .filter((n) => n !== "_layout")
    .sort();

  it("registr jmenuje PRÁVĚ ty routy, které v (tabs)/ existují", () => {
    expect(TABS.map((t) => t.name).sort()).toEqual(routeFiles);
  });

  it("registr nemá duplicity — dvakrát týž tab je dvakrát táž pravda", () => {
    const names = TABS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("profil smí jmenovat jen taby, které existují", () => {
    const known = new Set(TABS.map((t) => t.name));
    expect(visibleTabs(TABS, ["wallet", "neexistuje"])).toEqual(["wallet"]);
    expect(known.has("neexistuje")).toBe(false);
  });

  it("dedikovaná appka může mít jediný tab, nebo žádný", () => {
    expect(visibleTabs(TABS, ["index"])).toEqual(["index"]);
    expect(visibleTabs(TABS, ["neexistuje"])).toEqual([]);
  });
});
