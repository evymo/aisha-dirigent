/**
 * WebPageShell — tři stavy, které se nesmějí slít do jednoho.
 *
 * ⛔ NAMĚŘENO 2026-09-01 na živém webu instance: `/tahle-stranka-neexistuje`
 * vracelo ÚPLNĚ BÍLOU stránku (`innerText` délky 0), zatímco `/aaa/bbb` —
 * které na routu `/:slug` nesedí — 404 ukázalo správně. Shell vracel `null`
 * s komentářem „let router try fallback routes"; React Router v6 ale další
 * routu nezkouší, takže se `*` s <NotFound /> nikdy nedostalo ke slovu.
 *
 * Test hlídá ROZDÍL, ne jen „něco se vykreslí":
 *   načítá se        → nic (nesmí probliknout cizí chrome)
 *   dotaz selhal     → nic (výpadek API NENÍ „stránka neexistuje")
 *   úspěch bez řádku → to, co si zavolající vyžádal v `kdyzChybi`
 *
 * Prostřední případ je ten, na který jsem sám doplatil: první verze opravy
 * měla `if (error || !page)`, takže by při nedostupném API každá adresa
 * tvrdila „404". To je nepravda o cizí věci — stránka nejspíš existuje.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockUseWebPage = vi.fn();

vi.mock("@/hooks/useWebPage", () => ({ useWebPage: () => mockUseWebPage() }));
vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: () => ({}),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => false }),
}));
vi.mock("@/hooks/use-document-title", () => ({ useDocumentTitle: () => undefined }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { exists: () => false } }),
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ slug: "cokoliv" }) }));
vi.mock("@/components/layout/Header", () => ({ Header: () => <div>hlavička</div> }));
vi.mock("@/components/layout/Footer", () => ({ Footer: () => <div>patička</div> }));
vi.mock("@/components/web/PageRenderer", () => ({
  PageRenderer: () => <div>obsah stránky</div>,
}));

import { WebPageShell } from "@/components/web/WebPageShell";

const NAHRADA = <div data-testid="nahrada">konec cesty</div>;

describe("WebPageShell — prázdno není odpověď", () => {
  beforeEach(() => mockUseWebPage.mockReset());

  it("úspěch bez stránky vykreslí to, co si routa vyžádala (ne bílou stránku)", () => {
    mockUseWebPage.mockReturnValue({ data: null, isLoading: false, error: null });
    const { container } = render(<WebPageShell kdyzChybi={NAHRADA} />);
    expect(screen.getByTestId("nahrada")).toBeTruthy();
    expect(container.textContent).toContain("konec cesty");
  });

  it("BEZ `kdyzChybi` zůstává prázdno — o náhradě rozhoduje nadřazená komponenta", () => {
    mockUseWebPage.mockReturnValue({ data: null, isLoading: false, error: null });
    const { container } = render(<WebPageShell />);
    expect(container.textContent).toBe("");
  });

  it("SELHÁNÍ DOTAZU nevykreslí náhradu — výpadek API není „stránka neexistuje“", () => {
    mockUseWebPage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("gateway 502"),
    });
    const { container } = render(<WebPageShell kdyzChybi={NAHRADA} />);
    expect(screen.queryByTestId("nahrada")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("během načítání se nekreslí ani náhrada, ani cizí chrome", () => {
    mockUseWebPage.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = render(<WebPageShell kdyzChybi={NAHRADA} />);
    expect(screen.queryByTestId("nahrada")).toBeNull();
    expect(container.textContent).not.toContain("hlavička");
  });

  it("stránka s chrome dodá hlavičku i patičku; s `chrome: none` ani jedno", () => {
    const stranka = {
      canvas_css: "",
      canvas_html: "<p>x</p>",
      id: "1",
      title_key: "web.x.title",
      description_key: null,
    };
    mockUseWebPage.mockReturnValue({
      data: { ...stranka, page_settings: null },
      isLoading: false,
      error: null,
    });
    const sChrome = render(<WebPageShell />);
    expect(sChrome.container.textContent).toContain("hlavička");

    mockUseWebPage.mockReturnValue({
      data: { ...stranka, page_settings: { chrome: "none" } },
      isLoading: false,
      error: null,
    });
    const bez = render(<WebPageShell />);
    expect(bez.container.textContent).not.toContain("hlavička");
    expect(bez.container.textContent).toContain("obsah stránky");
  });
});
