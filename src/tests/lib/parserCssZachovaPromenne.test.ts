/**
 * Parser CSS editoru nesmí zahodit zkratky s proměnnými (2026-10-02, naměřeno na instanci).
 *
 * Výchozí parser GrapesJS četl deklarace po dílčích vlastnostech; zkratka
 * s `var()` je má v CSSOM prázdné, a tak zmizela — první změna stylu v editoru
 * pak uložila CSS celé stránky bez nich (úvodní stránka instance: 40/40 pryč).
 *
 * jsdom má jiný CSSOM než prohlížeč, proto se tu měří hlavně čistá část
 * (rozklad `cssText`) a tvar výstupu. Chování v prohlížeči změřeno v Chromiu
 * 154 nad CSS úvodní stránky ze seedu: 114 pravidel, 46 zkratek s var() —
 * výchozí algoritmus zachoval 0, tento 46; zpětný převod 114/114 beze změny.
 */
import { describe, expect, it } from "vitest";
import grapesjs from "grapesjs";
import { deklaraceZCssText, jeSelektorEditoru, parserCssZachovaPromenne, pravidlaZeSeznamu } from "@/lib/builder/parserCssZachovaPromenne";
import { getPageEditorConfig } from "@/lib/builder/editorConfig";

describe("deklaraceZCssText", () => {
  it("zkratka s proměnnou zůstane celá", () => {
    expect(deklaraceZCssText("background: linear-gradient(to top, var(--a) 0%, var(--b) 72%); color: rgb(255, 255, 255);")).toEqual({
      background: "linear-gradient(to top, var(--a) 0%, var(--b) 72%)",
      color: "rgb(255, 255, 255)",
    });
  });

  it("středník uvnitř závorek ani uvozovek deklaraci nerozdělí", () => {
    const d = deklaraceZCssText(
      `background-image: url("data:image/svg+xml;utf8,<svg/>"); --ikona: url(data:image/png;base64,AAAA); content: "a;b";`,
    );
    expect(d["background-image"]).toBe('url("data:image/svg+xml;utf8,<svg/>")');
    expect(d["--ikona"]).toBe("url(data:image/png;base64,AAAA)");
    expect(d.content).toBe('"a;b"');
  });

  it("!important zůstane u hodnoty jako u GrapesJS; prázdné kusy se přeskočí", () => {
    expect(deklaraceZCssText("padding: var(--space-6) !important;;  ; margin:0")).toEqual({
      padding: "var(--space-6) !important",
      margin: "0",
    });
  });
});

describe("jeSelektorEditoru — tytéž případy jako regexy grapesjs parseSelector", () => {
  it.each([
    [".hero", true], [".btn.btn--lg", true], [".btn:hover", true], [".a::before", true],
    [".a:not(.b)", true], [".a:hover:focus", true], ["#hlavni", true], ["#hlavni:hover", true],
    [".gjs-page-content .card", false], ["body", false], ["a:hover", false], ["#a.b", false],
    [".a:", false], [".a:(x)", false], [".a:not(.b", false], ["", false], [".", false],
  ])("%s → %s", (sel, ocekavano) => {
    expect(jeSelektorEditoru(sel)).toBe(ocekavano);
  });
});

describe("parserCssZachovaPromenne — tvar výstupu jako vestavěný parser", () => {
  it("třídy, stav a media dotaz", () => {
    const pravidla = parserCssZachovaPromenne(
      ".hero { background: linear-gradient(var(--a), var(--b)); } @media (max-width: 600px) { .btn.btn--lg:hover { gap: var(--g); } }",
    );
    const hero = pravidla.find((p) => p.selectors.join() === "hero");
    expect(hero?.style.background).toContain("var(--a)");
    const btn = pravidla.find((p) => p.selectors.join() === "btn,btn--lg");
    expect(btn?.state).toBe("hover");
    expect(btn?.atRuleType).toBe("media");
    expect(String(btn?.mediaText)).toContain("600px");
  });

  it("složitější selektor jde do selectorsAdd (jako vestavěný parser)", () => {
    const [p] = parserCssZachovaPromenne(".gjs-page-content .card { padding: var(--space-5); }");
    expect(p.selectors).toEqual([]);
    expect(p.selectorsAdd).toBe(".gjs-page-content .card");
  });

  it("editor ho používá", () => {
    expect(getPageEditorConfig().parser?.parserCss).toBe(parserCssZachovaPromenne);
  });
});

/**
 * Pravidlo přesně tak, jak ho vydá CSSOM Chrome pro zkratku s proměnnou
 * (změřeno 2026-10-02 v Chromiu 154): dílčí vlastnosti jsou vyjmenované, ale
 * jejich hodnoty PRÁZDNÉ; celou zkratku nese jen `cssText`. jsdom se chová
 * jinak (zkratku nerozloží), proto se tu chování prohlížeče podstrčí.
 */
function pravidloJakoVChrome() {
  const dilci = ["background-image", "background-position-x", "background-position-y", "background-size",
    "background-repeat", "background-attachment", "background-origin", "background-clip", "background-color"];
  const style = Object.assign(Object.fromEntries(dilci.map((p, i) => [i, p])), {
    length: dilci.length,
    getPropertyValue: () => "",
    getPropertyPriority: () => "",
    cssText: "background: linear-gradient(to top, var(--color-blue-hero-top) 0%, var(--color-blue-hero-bottom) 72%); color: rgb(255, 255, 255);",
  });
  return { type: 1, selectorText: ".hero", cssText: "", style };
}

/** Čtení po dílčích vlastnostech — tak to dělá vestavěný parser GrapesJS 0.22. */
function cteniPoDilcich(style: { length: number; getPropertyValue: (p: string) => string } & Record<number, string>) {
  const out: Record<string, string> = {};
  for (let i = 0; i < style.length; i++) {
    const v = style.getPropertyValue(style[i]);
    if (v) out[style[i]] = v;
  }
  return out;
}

describe("chování prohlížeče (Chrome): zkratka s proměnnou", () => {
  it("čtení po dílčích vlastnostech o ni přijde — tenhle parser ne", () => {
    const pravidlo = pravidloJakoVChrome();
    expect(cteniPoDilcich(pravidlo.style), "vada vestavěného parseru").toEqual({});
    const [uzel] = pravidlaZeSeznamu({ cssRules: [pravidlo] as unknown as CSSRuleList });
    expect(uzel.selectors).toEqual(["hero"]);
    expect(uzel.style.background).toBe("linear-gradient(to top, var(--color-blue-hero-top) 0%, var(--color-blue-hero-bottom) 72%)");
    expect(uzel.style.color).toBe("rgb(255, 255, 255)");
  });
});

// jsdom zkratku s var() nerozkládá, takže tenhle test vadu sám nechytí (výchozí
// parser by tu prošel taky) — ověřuje, že náš parser v GrapesJS funguje celou
// cestou setStyle → getCss.
describe("GrapesJS s tímto parserem (headless, jsdom)", () => {
  it("setStyle → getCss: zkratka s proměnnou přežije editor", () => {
    const editor = grapesjs.init({
      headless: true,
      storageManager: false,
      parser: getPageEditorConfig().parser,
    });
    editor.setStyle(".hero { background: linear-gradient(to top, var(--a) 0%, var(--b) 72%); color: #fff; } .card { padding: var(--space-5); gap: var(--g); }");
    const css = editor.getCss({ keepUnusedStyles: true }) ?? "";
    editor.destroy();
    expect(css).toMatch(/\.hero\{[^}]*background:linear-gradient\(to top, ?var\(--a\) 0%, ?var\(--b\) 72%\)/);
    expect(css).toMatch(/\.card\{[^}]*padding:var\(--space-5\)/);
    expect(css).toMatch(/\.card\{[^}]*gap:var\(--g\)/);
  });
});
