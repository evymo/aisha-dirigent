/**
 * Runtime blok se montuje NA MÍSTO, ne vedle.
 *
 * NAMĚŘENO 2026-09-01 na produkci. Renderer dřív plátno DĚLIL na úseky
 * (`splitCanvasSegments`) a každý úsek balil do vlastního `div`u. Blok tím
 * pádem nikdy neskončil tam, kde stojí jeho zástupný symbol:
 *
 *     cesta:     SELECT.nav__lang-vyber → LABEL.nav__lang → DIV.gjs-page-content
 *     vHlavicce: false
 *
 * Dvě viditelné škody: přepínač jazyků vložený do hlavičky se vykreslil POD ní
 * jako cizí pruh, a obsah, který v rodiči následoval PO bloku, se od svého
 * obalu oddělil — tlačítka hlavičky měla rozměr 0x0 a vypadla ven.
 *
 * Tenhle test hlídá OBĚ vlastnosti, protože oprava se dá udělat půlkatě:
 *   · blok je POTOMKEM svého původního rodiče (ne sourozencem obalu)
 *   · sourozenci PO bloku zůstanou ve svém rodiči
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "cs" }, t: (k: string) => k }),
}));
vi.mock("@/hooks/useWebPartials", () => ({
  useWebPartials: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useDynamicTranslations", () => ({
  useDynamicTranslationsMap: () => ({}),
}));
vi.mock("@/components/web/RuntimeBlockRenderer", () => ({
  RuntimeBlockRenderer: ({ blockType }: { blockType: string }) => (
    <span data-testid={`blok-${blockType}`}>blok {blockType}</span>
  ),
}));

import { PageRenderer } from "@/components/web/PageRenderer";

const HLAVICKA = `
  <header class="nav">
    <div class="nav__inner">
      <a class="nav__brand" href="/">značka</a>
      <div data-runtime-block="language-switcher"></div>
      <a class="btn" href="/download/">Stáhnout</a>
    </div>
  </header>
  <section class="hero"><h1>Nadpis</h1></section>`;

describe("PageRenderer — bloky se montují na místo", () => {
  it("blok je POTOMKEM svého rodiče v plátně, ne sourozencem obalu", async () => {
    render(<PageRenderer canvasCss={null} canvasHtml={HLAVICKA} />);

    const blok = await screen.findByTestId("blok-language-switcher");
    expect(blok.closest("header.nav"), "blok vypadl z hlavičky").not.toBeNull();
    expect(blok.closest(".nav__inner"), "blok vypadl z nav__inner").not.toBeNull();
  });

  it("sourozenec ZA blokem zůstane ve svém rodiči", async () => {
    const { container } = render(<PageRenderer canvasCss={null} canvasHtml={HLAVICKA} />);
    await screen.findByTestId("blok-language-switcher");

    const tlacitko = container.querySelector("a.btn");
    expect(tlacitko, "tlačítko se nevykreslilo").not.toBeNull();
    expect(
      tlacitko?.closest(".nav__inner"),
      "tlačítko za blokem vypadlo z obalu — to je ta produkční vada",
    ).not.toBeNull();
  });

  it("zástupný náhled pro editor se nahradí, neprosvítá", async () => {
    const sNahledom = `<div class="obal">
      <div data-runtime-block="news-list"><p>zástupný text pro editor</p></div>
    </div>`;
    const { container } = render(<PageRenderer canvasCss={null} canvasHtml={sNahledom} />);

    await screen.findByTestId("blok-news-list");
    expect(container.textContent).not.toContain("zástupný text pro editor");
  });

  it("stránka BEZ bloků se vykreslí beze změny struktury", () => {
    const { container } = render(
      <PageRenderer canvasCss={null} canvasHtml={`<section class="a"><p>text</p></section>`} />,
    );
    expect(container.querySelector("section.a p")?.textContent).toBe("text");
  });

  it("konfigurace bloku se přečte z data-block-config", async () => {
    const html = `<div data-runtime-block="news-list" data-block-config='{"limit":6}'></div>`;
    render(<PageRenderer canvasCss={null} canvasHtml={html} />);
    expect(await screen.findByTestId("blok-news-list")).toBeTruthy();
  });
});
