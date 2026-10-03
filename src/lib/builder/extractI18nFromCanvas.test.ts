import { describe, expect, it } from "vitest";
import { extractI18nFromCanvas } from "./extractI18nFromCanvas";

const byKey = (entries: { key: string; value: string }[]) =>
  Object.fromEntries(entries.map((e) => [e.key, e.value]));

describe("extractI18nFromCanvas", () => {
  it("returns nothing for empty input", () => {
    expect(extractI18nFromCanvas("")).toEqual([]);
    expect(extractI18nFromCanvas("<div>no keys here</div>")).toEqual([]);
  });

  it("extracts text content bound via data-i18n-key", () => {
    const entries = extractI18nFromCanvas(
      '<h1 data-i18n-key="web.hero.title">Hero Title</h1>',
    );
    expect(byKey(entries)).toEqual({ "web.hero.title": "Hero Title" });
  });

  it("extracts text content bound via the data-i18n alias", () => {
    const entries = extractI18nFromCanvas(
      '<p data-i18n="web.hero.subtitle">Subtitle</p>',
    );
    expect(byKey(entries)).toEqual({ "web.hero.subtitle": "Subtitle" });
  });

  // ⛔ ZNAČKY UVNITŘ SE ZACHOVÁVAJÍ — DŘÍV SE STRHÁVALY A NIČILY OBSAH
  // (naměřeno 2026-09-03, audit U5-3).
  //
  // Tenhle test dřív tvrdil opak („strips nested markup"), jenže druhá půlka
  // smyčky — resolveI18nInHtml v packages/web-canvas — přiřazuje překlad do
  // `innerHTML` ZÁMĚRNĚ, aby směl nést značky. Extrakce přes `textContent` tu
  // asymetrii proměnila ve ztrátu: co inject umí vložit, save sloupl.
  //
  // A není to teorie. Seed nese u `web.hero.lede` odkaz na dzogchen.net v en,
  // cs i de (celkem 8 překladů se značkami), ale živá databáze vracela tentýž
  // klíč BEZ odkazu — „among the practitioners of the Dzogchen Community"
  // místo „…of the <a class="hero__link" href="…">Dzogchen Community</a>".
  // Někdo stránku otevřel v editoru, uložil, a odkaz zmizel.
  //
  // Čistě textový prvek zůstává textem: jinak by se do překladů dostaly entity
  // (&amp;) tam, kde dřív nebyly.
  it("keeps nested markup in text bindings — inject side writes innerHTML", () => {
    const entries = extractI18nFromCanvas(
      '<h1 data-i18n-key="web.hero.title">  <span>Hero</span> Title  </h1>',
    );
    expect(byKey(entries)).toEqual({ "web.hero.title": "<span>Hero</span> Title" });
  });

  it("keeps a link inside a bound paragraph — the case that lost content in production", () => {
    const entries = extractI18nFromCanvas(
      '<p data-i18n-key="web.hero.lede">A safe space for the <a class="hero__link" href="https://dzogchen.net/">Dzogchen Community</a>.</p>',
    );
    expect(byKey(entries)["web.hero.lede"]).toContain(
      '<a class="hero__link" href="https://dzogchen.net/">Dzogchen Community</a>',
    );
  });

  it("trims whitespace and leaves a markup-free binding as plain text", () => {
    const entries = extractI18nFromCanvas(
      '<h1 data-i18n-key="web.hero.title">  Example &amp; App  </h1>',
    );
    expect(byKey(entries)).toEqual({ "web.hero.title": "Example & App" });
  });

  it("extracts attribute-bound translations (placeholder/title/aria-label/alt)", () => {
    const entries = extractI18nFromCanvas(`
      <input data-i18n-placeholder-key="web.search.ph" placeholder="Search…" />
      <button data-i18n-title-key="web.cta.title" title="Submit now">Go</button>
      <nav data-i18n-aria-label-key="web.nav.label" aria-label="Main navigation"></nav>
      <img data-i18n-alt-key="web.logo.alt" alt="Brand logo" />
    `);
    expect(byKey(entries)).toMatchObject({
      "web.search.ph": "Search…",
      "web.cta.title": "Submit now",
      "web.nav.label": "Main navigation",
      "web.logo.alt": "Brand logo",
    });
  });

  it("extracts text and attribute bindings from the same element", () => {
    const entries = extractI18nFromCanvas(
      '<button data-i18n-key="web.cta.label" data-i18n-aria-label-key="web.cta.aria" aria-label="Open menu">Menu</button>',
    );
    expect(byKey(entries)).toEqual({
      "web.cta.label": "Menu",
      "web.cta.aria": "Open menu",
    });
  });

  it("skips bindings whose value is empty", () => {
    const entries = extractI18nFromCanvas(
      '<input data-i18n-placeholder-key="web.x" placeholder="" /><h1 data-i18n-key="web.y"></h1>',
    );
    expect(entries).toEqual([]);
  });

  it("deduplicates by key (last occurrence wins)", () => {
    const entries = extractI18nFromCanvas(
      '<h1 data-i18n-key="web.dup">First</h1><h2 data-i18n-key="web.dup">Second</h2>',
    );
    expect(byKey(entries)).toEqual({ "web.dup": "Second" });
  });
});
