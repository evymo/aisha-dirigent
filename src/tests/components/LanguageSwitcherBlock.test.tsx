/**
 * Volba jazyka v hlavičce webu — co se do nabídky NESMÍ dostat.
 *
 * ⛔ `global` NENÍ JAZYK (naměřeno 2026-09-01 na živém webu instance).
 * `get_supported_languages` vrací na téhle instanci devět položek a jedna
 * z nich je `global:Global` — pseudo-locale pro obsah bez jazyka. Návštěvníkovi
 * se nabídnout nesmí. Filtruje se podle TVARU kódu (ISO 639-1), ne podle jména:
 * seznam zakázaných jmen by byla magická konstanta, která zestárne.
 *
 * ⛔ NEZNÁMÝ SEZNAM SE NENAHRAZUJE DOMNĚNKOU. Původní platformní přepínač měl
 * `fallbackLanguages = [en, cs]` pro případ nedostupné DB. Na veřejném webu by
 * to TVRDILO, že instance umí dva jazyky, i když jich nabízí osm.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockJazyky = vi.fn();
const mockChangeLanguage = vi.fn();

vi.mock("@/hooks/useSupportedLanguages", () => ({
  useSupportedLanguages: () => mockJazyky(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { changeLanguage: mockChangeLanguage, language: "cs" },
    t: (k: string) => k,
  }),
}));

import { LanguageSwitcherBlock } from "@/components/web/blocks/LanguageSwitcherBlock";

const ZIVE = [
  { code: "en", name_native: "English" },
  { code: "global", name_native: "Global" },
  { code: "cs", name_native: "Čeština" },
  { code: "de", name_native: "Deutsch" },
];

describe("LanguageSwitcherBlock", () => {
  beforeEach(() => {
    mockJazyky.mockReset();
    mockChangeLanguage.mockReset();
  });

  it("nabídne skutečné jazyky a `global` mezi ně nepustí", () => {
    mockJazyky.mockReturnValue({ data: ZIVE });
    render(<LanguageSwitcherBlock config={{}} />);

    const volby = screen.getAllByRole("option").map((o) => o.textContent);
    expect(volby).toEqual(["English", "Čeština", "Deutsch"]);
    expect(volby).not.toContain("Global");
  });

  it("vybraný je jazyk, ve kterém se web právě zobrazuje", () => {
    mockJazyky.mockReturnValue({ data: ZIVE });
    render(<LanguageSwitcherBlock config={{}} />);
    expect(screen.getByRole("combobox")).toHaveProperty("value", "cs");
  });

  it("dokud seznam nedorazí, NEVYKRESLÍ SE NIC — žádný náhradní seznam", () => {
    mockJazyky.mockReturnValue({ data: undefined });
    const { container } = render(<LanguageSwitcherBlock config={{}} />);
    expect(container.textContent).toBe("");
  });

  it("jediná volba není volba — prvek se nekreslí", () => {
    mockJazyky.mockReturnValue({ data: [{ code: "en", name_native: "English" }] });
    const { container } = render(<LanguageSwitcherBlock config={{}} />);
    expect(container.textContent).toBe("");
  });

  it("položka bez použitelného kódu nebo jména se zahodí", () => {
    mockJazyky.mockReturnValue({
      data: [
        { code: "en", name_native: "English" },
        { code: "cs", name_native: "" },
        { code: "x", name_native: "Divné" },
        { code: "pt-BR", name_native: "Português" },
      ],
    });
    render(<LanguageSwitcherBlock config={{}} />);
    const volby = screen.getAllByRole("option").map((o) => o.textContent);
    // `x` (jednopísmenný kód) i `cs` (prázdné jméno) vypadly.
    expect(volby).toContain("English");
    expect(volby).toContain("Português");
    expect(volby).not.toContain("Divné");
  });

  // ⛔ NEZNÁMÝ AKTUÁLNÍ JAZYK SE NEPŘEDSTÍRÁ. Zjištěno testem výš: když se web
  // zobrazuje v jazyce, který v nabídce není (tady `cs` vypadlo kvůli prázdnému
  // jménu), `select` bez shody ukáže jako vybranou PRVNÍ položku — tedy by
  // tvrdil „zobrazuje se anglicky", i když je stránka česky. Prázdná volba `—`
  // je poctivější: říká „nevím", místo aby ukázala na cizí jazyk.
  it("neznámý aktuální jazyk se neschová za první položku", () => {
    mockJazyky.mockReturnValue({
      data: [
        { code: "en", name_native: "English" },
        { code: "de", name_native: "Deutsch" },
      ],
    });
    render(<LanguageSwitcherBlock config={{}} />);
    expect(screen.getByRole("combobox")).toHaveProperty("value", "");
    expect(screen.getAllByRole("option").map((o) => o.textContent)[0]).toBe("—");
  });
});
