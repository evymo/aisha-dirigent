/**
 * Brána: „Abecedně (A–Z)" řadí podle TITULKU, ne podle klíče.
 *
 * ⛔ CO SE NAMĚŘILO (2026-09-21). `get_published_news_articles_filtered` řadila při
 * `p_sort = 'alpha'` podle `na.title_key`, tedy podle i18n KLÍČE článku
 * (`news.article.42.title`). Titulek ale v tom sloupci není — žije v `translations`
 * N-krát, pro každý jazyk jeden. Volba „abecedně" tedy vracela pořadí podle času
 * vzniku klíče a vypadala přitom, že funguje.
 *
 * Oprava potřebuje znát jazyk čtenáře (`p_locale`), a to je nový podpis funkce.
 * Tahle brána drží obě půlky, protože každá sama o sobě je tichá:
 *   • SQL nesmí řadit podle `title_key` a musí číst hodnotu z `translations`;
 *   • klient MUSÍ `p_locale` posílat — bez něj se abecedně nemá o co opřít
 *     (funkce ŽÁDNÝ jazyk nedosazuje) a pořadí tiše spadne zpět na datum;
 *   • locale MUSÍ být v klíči cache, jinak si dva jazyky sdílí jednu odpověď.
 *
 * Run: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const cti = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
const bezKomentaru = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const bezSqlKomentaru = (src: string): string => src.replace(/^\s*--[^\n]*$/gm, "");

const SQL = "aisha/db/sql/functions/get_published_news_articles_filtered.sql";
const HOOK = "src/hooks/useNewsArticles.ts";

describe("abecední řazení novinek", () => {
  it("SQL neřadí podle klíče titulku", () => {
    const src = bezSqlKomentaru(cti(SQL));
    expect(src, "soubor chybí").not.toBe("");
    expect(
      /p_sort\s*=\s*'alpha'\s*THEN\s+na\.title_key/i.test(src),
      "`alpha` nesmí řadit podle `na.title_key` — to je i18n klíč, ne titulek",
    ).toBe(false);
  });

  it("SQL řadí podle hodnoty titulku v požadovaném jazyce", () => {
    const src = bezSqlKomentaru(cti(SQL));
    expect(src).toMatch(/p_locale/);
    expect(src, "titulek se musí číst z translations podle klíče A jazyka").toMatch(
      /FROM\s+public\.translations[\s\S]{0,200}tr\.locale\s*=\s*p_locale/i,
    );
  });

  it("nový parametr je NA KONCI a stará signatura je zahozená", () => {
    const src = cti(SQL);
    expect(
      src,
      "bez DROP by `CREATE OR REPLACE` vyrobil PŘETÍŽENÍ a PostgREST by volání " +
        "s pojmenovanými argumenty odmítl jako nejednoznačné",
    ).toMatch(/DROP FUNCTION IF EXISTS public\.get_published_news_articles_filtered\(text, text\[\], text, integer, integer\)/);

    const podpis = /CREATE OR REPLACE FUNCTION public\.get_published_news_articles_filtered\(([^)]*)\)/.exec(src)?.[1] ?? "";
    const parametry = podpis.split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean);
    expect(parametry[parametry.length - 1], "nový parametr patří na KONEC podpisu").toBe("p_locale");
  });

  it("grant sedí na NOVOU signaturu — jinak by RPC nikdo nesměl volat", () => {
    const src = cti(SQL);
    for (const role of ["anon", "authenticated"]) {
      expect(
        src,
        `chybí GRANT pro ${role} na šestiargumentovou signaturu`,
      ).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.get_published_news_articles_filtered\\(text, text\\[\\], text, integer, integer, text\\) TO ${role}`));
    }
  });

  it("klient posílá p_locale a má ho v klíči cache", () => {
    const src = bezKomentaru(cti(HOOK));
    expect(src, "klient p_locale neposílá — abecední řazení by nemělo o co opřít").toMatch(/p_locale:/);
    expect(src, "locale se musí odvodit z jazyka UI, ne dosadit").toMatch(/getTranslationLocale\(/);

    const kotva = src.indexOf('"news-browse"');
    expect(kotva, "nenašel jsem klíč cache listingu").toBeGreaterThan(-1);
    // ⛔ Konec klíče je `] as const`, ne první `]`: v klíči je `[...tags].sort()`,
    // takže hledat první hranatou závorku znamená uříznout klíč v půlce (na tomhle
    // brána sama poprvé spadla).
    const konec = src.indexOf("] as const", kotva);
    expect(konec, "klíč cache nekončí `] as const` — zkontroluj tvar").toBeGreaterThan(kotva);
    const klic = src.slice(kotva, konec);
    expect(
      klic,
      "locale patří do klíče cache — jinak si dva jazyky sdílí jednu odpověď a druhý " +
        "dostane cizí pořadí",
    ).toMatch(/locale/);
  });
});
