import { describe, expect, it } from "vitest";

import { scopeCanvasCss } from "./scopeCanvasCss";

describe("scopeCanvasCss", () => {
  it("maps :root to the page wrapper ITSELF, not a non-matching descendant", () => {
    const out = scopeCanvasCss(":root{--color-primary:#c98a3d}");
    expect(out).toContain(".gjs-page-content {");
    expect(out).not.toContain(".gjs-page-content :root");
    expect(out).not.toMatch(/:root/);
  });

  it("maps html and body (incl. comma lists) to the wrapper", () => {
    const out = scopeCanvasCss("html, body { margin: 0 }");
    expect(out).toContain(".gjs-page-content, .gjs-page-content {");
    expect(out).not.toContain(".gjs-page-content html");
    expect(out).not.toContain(".gjs-page-content body");
  });

  it("maps a body background rule (the deepened-template case) to the wrapper", () => {
    const out = scopeCanvasCss("body { background: var(--color-bg); }");
    expect(out).toContain(".gjs-page-content {");
    expect(out).not.toContain(".gjs-page-content body");
  });

  it("descendant-scopes ordinary class selectors", () => {
    const out = scopeCanvasCss(".wrap { color: red }");
    expect(out).toContain(".gjs-page-content .wrap {");
  });

  it("handles mixed root + descendant comma lists per-selector", () => {
    const out = scopeCanvasCss(":root, .hero { color: red }");
    expect(out).toContain(".gjs-page-content, .gjs-page-content .hero {");
  });

  it("preserves bare-HSL custom-property values verbatim (theming relies on this)", () => {
    const out = scopeCanvasCss(":root{--primary:31 56% 51%}");
    expect(out).toContain("--primary:31 56% 51%");
  });

  // ⛔ NAPSÁNO ČERVENÉ proti starému vzoru (naměřeno 2026-09-02 na produkci).
  //
  // Vzor `/(^|\})\s*([^@{}]+?)\s*\{/g` se kotvil na začátku vstupu a za `}`.
  // Prvnímu pravidlu uvnitř `@media (…) {` předchází `{`, takže PRVNÍ pravidlo
  // každého at-bloku zůstalo neoborované — a při specificitě (0,1,0) prohrálo
  // s oborovaným základem (0,2,0). Hero pak na 375 px drželo dva sloupce.
  it("scopes the FIRST rule inside a media block, not just the later ones", () => {
    const out = scopeCanvasCss(
      "@media (max-width: 860px) { .hero__inner { grid-template-columns: 1fr } .hero__art { order: 1 } }",
    );

    expect(out).toContain(".gjs-page-content .hero__inner {");
    expect(out).toContain(".gjs-page-content .hero__art {");
    expect(out).toContain("@media (max-width: 860px)");
  });

  it("keeps a media override at the same specificity as the base rule it overrides", () => {
    const out = scopeCanvasCss(
      ".hero__inner { grid-template-columns: 1.05fr 0.95fr }" +
        "@media (max-width: 860px) { .hero__inner { grid-template-columns: 1fr } }",
    );

    // Obě `.hero__inner` musí být oborovaná — jinak přepis mlčky neplatí.
    expect(out.match(/\.gjs-page-content \.hero__inner/g)).toHaveLength(2);
  });

  it("leaves @keyframes frames alone (`to` is a frame, not a selector)", () => {
    const out = scopeCanvasCss("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }");

    expect(out).not.toContain(".gjs-page-content to");
    expect(out).not.toContain(".gjs-page-content from");
  });

  it("scopes inside @supports and @container too", () => {
    const out = scopeCanvasCss(
      "@supports (display: grid) { .a { color: red } }@container (min-width: 20rem) { .b { color: blue } }",
    );

    expect(out).toContain(".gjs-page-content .a {");
    expect(out).toContain(".gjs-page-content .b {");
  });

  it("passes block-less at-rules through untouched", () => {
    const out = scopeCanvasCss("@import url(x.css);.a { color: red }");

    expect(out).toContain("@import url(x.css);");
    expect(out).toContain(".gjs-page-content .a {");
  });

  it("does not let a brace inside a string terminate a block", () => {
    const out = scopeCanvasCss('.a::after { content: "}" }.b { color: red }');

    expect(out).toContain(".gjs-page-content .b {");
  });

  // ── Komentáře ──────────────────────────────────────────────────────────
  // Přeneseno ze src/tests/components/scopeCanvasCss.test.ts, který jsem
  // 2026-09-01 založil, aniž bych si všiml, že testy pro tento modul už leží
  // vedle kódu. Dva soubory pro jeden modul znamenají, že příští autor doplní
  // jen jeden z nich. Zbylých pět testů se s tímto souborem překrývalo.

  it("a comment before the root selector does not break root mapping", () => {
    const out = scopeCanvasCss("a { color: red; }\n/* poznámka autora */\n:root { --x: 1px; }");

    expect(out, "komentář rozhodil mapování kořene").not.toContain(".gjs-page-content :root");
    expect(out).toContain(".gjs-page-content {");
  });

  // ⛔ TENHLE PŘÍPAD ROZHODL. První oprava čistila až zachycený selektor
  // a na tomhle vstupu selhala: vzor `[^@{}]` nedokáže přejít složenou
  // závorku, a komentář ji běžně obsahuje. Regulární výraz se pak zachytil
  // UVNITŘ komentáře a scopování bylo od toho místa rozsypané.
  it("a comment containing braces does not derail scoping", () => {
    const out = scopeCanvasCss(
      "/* poznámka s { závorkou } uvnitř */\n:root { --x: 1px; }\n.nav { color: red; }",
    );

    expect(out, "kořen se nenamapoval na obal").toContain(".gjs-page-content {");
    expect(out).not.toContain(".gjs-page-content :root");
    expect(out).toContain(".gjs-page-content .nav");
    expect(out, "komentář zůstal ve výstupu").not.toContain("poznámka");
  });

  it("strips comments rather than carrying them into the output", () => {
    const out = scopeCanvasCss("a { color: red; }\n/* proč */\n.karta { color: blue; }");

    expect(out).toContain(".gjs-page-content .karta");
    expect(out).not.toContain("/*");
  });

  it("returns empty string for empty input", () => {
    expect(scopeCanvasCss("")).toBe("");
  });
});
