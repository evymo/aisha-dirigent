import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  expandPartials,
  extractI18nKeys,
  hasPartials,
  stripHtmlForAttribute,
  hasRuntimeBlocks,
  resolveI18nInHtml,
  resolveTranslation,
  splitCanvasSegments,
} from "./index.js";

/** Parser pro Node — v prohlížeči by se předal DOMParser. */
const parseHtml = (html: string): Document =>
  new JSDOM(`<!doctype html><body>${html}</body>`).window.document;

/** Sanitizér pro Node — v prohlížeči by se předal DOMPurify nad window. */
const purify = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);
const sanitize = ((html: string, opts: never) => purify.sanitize(html, opts)) as never;

describe("extractI18nKeys", () => {
  it("najde klíče v textu i v atributových vazbách", () => {
    const html = `
      <h1 data-i18n-key="web.title">Nadpis</h1>
      <input data-i18n-placeholder-key="web.search" placeholder="Hledat">
      <img data-i18n-alt-key="web.logo.alt" alt="Logo">
      <a data-i18n="web.nav.home">Domů</a>`;

    expect(extractI18nKeys(html, parseHtml).sort()).toEqual([
      "web.logo.alt",
      "web.nav.home",
      "web.search",
      "web.title",
    ]);
  });

  it("beze klíčů vrátí prázdno, ne výjimku", () => {
    expect(extractI18nKeys("<p>nic</p>", parseHtml)).toEqual([]);
  });
});

describe("resolveTranslation — pořadí vrstev", () => {
  const map = { "a.key": "z databáze" };

  it("databáze vyhrává nad katalogem i nad textem autora", () => {
    expect(resolveTranslation("a.key", map, () => "z katalogu", "od autora")).toBe("z databáze");
  });

  it("katalog vyhrává nad textem autora", () => {
    expect(resolveTranslation("b.key", map, () => "z katalogu", "od autora")).toBe("z katalogu");
  });

  it("⛔ KLÍČ ZPÁTKY JE MINUTÍ, ne hodnota — jinak by se vykreslil syrový klíč", () => {
    // i18next při minutí vrací klíč doslova. Bez téhle podmínky by se
    // návštěvníkovi zobrazilo `b.key` jako viditelný text stránky.
    expect(resolveTranslation("b.key", map, (k) => k, "od autora")).toBe("od autora");
  });

  it("⛔ PRÁZDNÁ HODNOTA Z DB JE ZÁSAH, ne minutí", () => {
    // Překladatel smí popisek vědomě vyprázdnit (skrytý prvek). Kdyby se to
    // bralo jako minutí, vrátil by se text autora — tedy obsah, který někdo
    // záměrně odstranil.
    expect(resolveTranslation("k", { k: "" }, () => "z katalogu", "od autora")).toBe("");
  });

  it("⛔ POSLEDNÍ INSTANCE JE KATALOG, ne prázdno", () => {
    // Bez textu autora i bez zásahu v katalogu se vrátí katalogová hodnota
    // (tedy klíč). Viditelný klíč je lepší než prázdný prvek, po kterém
    // zůstane v rozvržení díra bez jakékoli stopy.
    expect(resolveTranslation("chybi.klic", {}, (k) => k, undefined)).toBe("chybi.klic");
  });

  it("bez katalogu spadne rovnou na text autora", () => {
    expect(resolveTranslation("b.key", map, undefined, "od autora")).toBe("od autora");
  });
});

describe("resolveI18nInHtml", () => {
  it("nahradí text i cílové atributy", () => {
    const html =
      `<h1 data-i18n-key="t">Původní</h1>` +
      `<input data-i18n-placeholder-key="p" placeholder="staré">`;

    const out = resolveI18nInHtml(html, { t: "Přeloženo", p: "Hledat…" }, parseHtml, sanitize);

    expect(out).toContain(">Přeloženo<");
    expect(out).toContain('placeholder="Hledat…"');
  });

  it("⛔ ATRIBUTOVÉ VAZBY jsou důvod, proč se nepoužívá regexová cesta", () => {
    // Regexová varianta umí jen vnitřní obsah. Kdyby generátor jel po ní
    // a prohlížeč po DOM, měla by generovaná stránka nepřeložený placeholder,
    // který by prohlížeč po převzetí opravil — viditelný přeskok.
    const html = `<input data-i18n-title-key="k" title="old">`;
    expect(resolveI18nInHtml(html, { k: "nové" }, parseHtml, sanitize)).toContain('title="nové"');
  });

  it("⛔ DO ATRIBUTU SE ZNAČKY NESMÍ — vykreslily by se doslova", () => {
    const html = `<input data-i18n-placeholder-key="k" placeholder="staré">`;
    const out = resolveI18nInHtml(html, { k: "a <b>b</b> c" }, parseHtml, sanitize);
    expect(out).toContain('placeholder="a b c"');
    expect(out).not.toContain("<b>");
  });

  it("bez překladu zůstane text autora, ne klíč", () => {
    const html = `<h1 data-i18n-key="chybi">Text od autora</h1>`;
    expect(resolveI18nInHtml(html, {}, parseHtml, sanitize)).toContain("Text od autora");
  });

  it("překlad smí nést značky (autor je tak napsal)", () => {
    const html = `<p data-i18n-key="k">x</p>`;
    const out = resolveI18nInHtml(html, { k: "a <strong>b</strong>" }, parseHtml, sanitize);
    expect(out).toContain("<strong>b</strong>");
  });
});

describe("splitCanvasSegments", () => {
  it("rozdělí na statické úseky a bloky ve správném pořadí", () => {
    const html = `<h1>před</h1><div data-runtime-block="news-list"></div><p>za</p>`;
    const seg = splitCanvasSegments(html);

    expect(seg.map((s) => s.type)).toEqual(["html", "runtime-block", "html"]);
    expect(seg[1].blockType).toBe("news-list");
    expect(seg[0].html).toContain("před");
    expect(seg[2].html).toContain("za");
  });

  it("přečte konfiguraci bloku včetně entit", () => {
    const html = `<div data-runtime-block="b" data-block-config='{&quot;limit&quot;:5}'></div>`;
    expect(splitCanvasSegments(html)[0].blockConfig).toEqual({ limit: 5 });
  });

  // ⛔ NAPSÁNO ČERVENÉ proti vzoru jen s apostrofy (naměřeno 2026-09-03, audit
  // U5-8): GrapesJS při uložení přepíše atribut na uvozovky s &quot;, a blok
  // se pak vykreslil s výchozím nastavením — bez chyby, protože „žádná
  // konfigurace" je platný stav.
  it("konfiguraci najde i v uvozovkách s &quot; — tak ji zapíše GrapesJS", () => {
    const html = `<div data-runtime-block="article-detail" data-block-config="{&quot;zpet&quot;:&quot;/news&quot;}"></div>`;

    const seg = splitCanvasSegments(html);

    expect(seg[0].blockConfig).toEqual({ zpet: "/news" });
    expect(seg[0].configError).toBeUndefined();
  });

  it("⛔ ROZBITÁ KONFIGURACE NESMÍ SHODIT STRÁNKU — je to vstup", () => {
    const html = `<div data-runtime-block="b" data-block-config='{nevalidní'></div>`;
    const seg = splitCanvasSegments(html);
    expect(seg[0].blockType).toBe("b");
    expect(seg[0].blockConfig).toEqual({});
    // ⛔ ALE MUSÍ TO BÝT VIDĚT: bez tohohle by autor marně hledal, proč
    // jeho nastavení bloku nefunguje. Balíček chybu nese, konzument ji zaloguje.
    expect(seg[0].configError).toBeTruthy();
  });

  it("platná konfigurace chybu nenese", () => {
    const html = `<div data-runtime-block="b" data-block-config='{&quot;a&quot;:1}'></div>`;
    expect(splitCanvasSegments(html)[0].configError).toBeUndefined();
  });

  it("bez bloků vrátí jediný statický úsek", () => {
    const seg = splitCanvasSegments("<p>jen text</p>");
    expect(seg).toHaveLength(1);
    expect(seg[0].type).toBe("html");
  });

  // ⛔ BLOK S OBSAHEM. Naměřeno 2026-09-01 na živém webu instance: v plátně
  // domovské stránky je `<div data-runtime-block="news-list" class="shares__feed">`
  // a UVNITŘ něj zástupný odstavec pro editor. Dělení bralo jen otevírací
  // značku, takže obsah i `</div>` zůstaly v NÁSLEDUJÍCÍM statickém úseku.
  // Ten se tím rozvážil: přebytečné `</div>` zavřelo `div.section__inner`
  // předčasně, prohlížeč strom dorovnal a zástupný odstavec vypadl ze své
  // sekce až nad patičku. Návštěvník tak pod plným seznamem článků četl
  // „Nejnovější sdílení komunity se zde objeví po naplnění instance."
  //
  // Vada přežila proto, že VŠECHNY testy nad touhle funkcí používaly PRÁZDNÝ
  // div. Skutečné plátno prázdné nemá.
  it("⛔ BLOK S OBSAHEM spolkne celý podstrom, ne jen otevírací značku", () => {
    const html =
      `<h1>před</h1>` +
      `<div data-runtime-block="news-list"><p class="ph">zástupný text</p></div>` +
      `<p>za</p>`;
    const seg = splitCanvasSegments(html);

    expect(seg.map((s) => s.type)).toEqual(["html", "runtime-block", "html"]);
    // Zástupný text patří bloku — po vykreslení ho nahradí komponenta.
    expect(seg[2].html).not.toContain("zástupný text");
    // A hlavně: v následujícím úseku NESMÍ zůstat osiřelé `</div>`.
    expect(seg[2].html).not.toContain("</div>");
    expect(seg[2].html).toContain("za");
  });

  it("⛔ VNOŘENÉ DIVY uvnitř bloku nerozhodí párování", () => {
    const html =
      `<div data-runtime-block="b"><div><div>hluboko</div></div></div>` + `<span>po</span>`;
    const seg = splitCanvasSegments(html);

    expect(seg.map((s) => s.type)).toEqual(["runtime-block", "html"]);
    expect(seg[1].html).toBe("<span>po</span>");
  });

  it("⛔ NEPÁROVÝ div se NEBERE jako blok — radši nevykreslený blok než rozbitá stránka", () => {
    // Nedá-li se najít konec, restrukturalizace by zahodila nebo přehodila
    // obsah. Úsek proto zůstane statický: blok se nevykreslí (vidět), ale
    // nic se neztratí a nic se nepřehází.
    const html = `<section><div data-runtime-block="b"><p>obsah</p></section>`;
    const seg = splitCanvasSegments(html);

    expect(seg.map((s) => s.type)).toEqual(["html"]);
    expect(seg[0].html).toContain("obsah");
  });

  it("je opakovatelné — regex si nedrží stav mezi voláními", () => {
    const html = `<div data-runtime-block="a"></div>`;
    expect(splitCanvasSegments(html)).toEqual(splitCanvasSegments(html));
  });
});

describe("hasRuntimeBlocks", () => {
  it("pozná přítomnost bloku", () => {
    expect(hasRuntimeBlocks(`<div data-runtime-block="x"></div>`)).toBe(true);
    expect(hasRuntimeBlocks("<p>nic</p>")).toBe(false);
  });
});

describe("stripHtmlForAttribute", () => {
  it("strhne značky a zmáčkne mezery", () => {
    expect(stripHtmlForAttribute("  a <b>b</b>\n  c ", sanitize)).toBe("a b c");
  });
});

describe("expandPartials", () => {
  const partials = { nav: `<header class="nav"><a data-i18n-key="web.nav.home">Home</a></header>` };

  it("dosadí útržek na místo značky", () => {
    const out = expandPartials(`<div data-partial="nav"></div><main>x</main>`, partials);
    expect(out.html).toContain('class="nav"');
    expect(out.html).toContain("<main>x</main>");
    expect(out.missing).toEqual([]);
  });

  it("⛔ KLÍČE Z ÚTRŽKU MUSÍ BÝT VIDĚT PRO EXTRAKCI — jinak se nepřeloží", () => {
    // Dosazení běží před `extractI18nKeys`; kdyby se pořadí obrátilo,
    // navigace by zůstala v původním jazyce až do druhého průchodu.
    const out = expandPartials(`<div data-partial="nav"></div>`, partials);
    expect(extractI18nKeys(out.html, parseHtml)).toEqual(["web.nav.home"]);
  });

  it("⛔ CHYBĚJÍCÍ ÚTRŽEK SE HLÁSÍ A ZNAČKA ZŮSTÁVÁ", () => {
    // Tiché smazání by vypadalo jako stránka bez hlavičky, tedy jako záměr.
    const out = expandPartials(`<div data-partial="chybi"></div>`, partials);
    expect(out.missing).toEqual(["chybi"]);
    expect(out.html).toContain('data-partial="chybi"');
  });

  it("⛔ JEDNA ÚROVEŇ — útržek uvnitř útržku se nerozbaluje (konečnost)", () => {
    const cyklus = { a: `<div data-partial="b"></div>`, b: `<div data-partial="a"></div>` };
    const out = expandPartials(`<div data-partial="a"></div>`, cyklus);
    expect(out.html).toBe(`<div data-partial="b"></div>`);
  });

  it("dosadí týž útržek na víc míst", () => {
    const out = expandPartials(`<div data-partial="nav"></div><div data-partial="nav"></div>`, partials);
    expect(out.html.match(/class="nav"/g)).toHaveLength(2);
  });

  it("je opakovatelné — regex si nedrží stav", () => {
    const h = `<div data-partial="nav"></div>`;
    expect(expandPartials(h, partials)).toEqual(expandPartials(h, partials));
  });

  it("bez značek vrátí vstup beze změny", () => {
    expect(expandPartials("<p>nic</p>", partials).html).toBe("<p>nic</p>");
  });
});

describe("hasPartials", () => {
  it("pozná značku", () => {
    expect(hasPartials(`<div data-partial="nav"></div>`)).toBe(true);
    expect(hasPartials("<p>nic</p>")).toBe(false);
  });
});
