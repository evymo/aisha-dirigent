/**
 * Brána: novinka napsaná v editoru je PŘELOŽITELNÁ a DOHLEDATELNÁ.
 *
 * ⛔ CO BYLO ROZBITÉ (naměřeno 2026-09-21 na instanci, 226 článků).
 *
 * 1. PŘEKLAD. Smyčka překladu plátna má tři půlky: `extractI18nFromCanvas`
 *    posbírá páry `data-i18n-key` → text, `upsert_translations` je zapíše,
 *    `PageRenderer` je podle jazyka rozřeší. Klíče do plátna ale nikdo nerazil —
 *    v `aishaBlocksPlugin` je `data-i18n-key` jedinkrát, a to ve funkci, která
 *    je jen ČTE. Text napsaný v editoru tedy klíč neměl, extrakce vrátila prázdno
 *    a zápis se ani nezavolal: článek zůstal jednojazyčný a nepřeložitelný ani
 *    ručně. Zavírá to `zajistiI18nKlice` (klicePlatna.ts).
 *
 * 2. NAMESPACE. `PageRenderer` rozřešuje s `namespace = null`, což zapíná
 *    odvození namespacu z PRVNÍHO SEGMENTU klíče. Klíč a namespace zápisu se
 *    proto MUSÍ shodovat, jinak text zmizí: klíč `web.…` uložený do `news` se
 *    hledá ve `web` a nenajde.
 *
 * 3. PRÁVO. Článek smí spravovat admin NEBO staff (policy „Admin/staff can
 *    manage news"), ale `upsert_translations` pouštěl jen admina — staff uložil
 *    článek a texty se zahodily. A `upsert_translations` navíc VŮBEC NEBYL
 *    v `heals.sql`, takže žádná jeho změna se na běžící databázi neprojevila.
 *
 * 4. HLEDÁNÍ. Listing knihovny hledal v surovém HTML a NEHLEDAL v `canvas_html`
 *    vůbec — každý článek napsaný v novém editoru by z knihovny zmizel
 *    (dohledatelný jen podle titulku).
 *
 * 5. SPRÁVA TEXTŮ. Filtr namespacu v administraci byl pevný seznam 14 hodnot bez
 *    `news` — překlady novinek nešlo ve správě překladů ani vybrat.
 *
 * Run: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const cti = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
/** Kód bez komentářů — próza nesmí měnit verdikt. */
const bezKomentaru = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const EDITOR_NOVINKY = "src/pages/admin/AdminNewsArticleEditor.tsx";
const PLATNO = "src/components/admin/page-builder/CanvasEditor.tsx";
const KLICE = "src/lib/builder/klicePlatna.ts";
const LISTING = "aisha/db/sql/functions/get_published_news_articles_filtered.sql";
const UPSERT = "aisha/db/sql/functions/upsert_translations.sql";
const HEALS = "aisha/db/heals.sql";
const SPRAVA_PREKLADU = "src/pages/admin/AdminTranslations.tsx";

describe("novinka napsaná v editoru je přeložitelná", () => {
  it("editor novinek dostane razítko klíčů i namespace `news`", () => {
    const src = bezKomentaru(cti(EDITOR_NOVINKY));
    expect(src, `${EDITOR_NOVINKY}: chybí i18nNamespace="news"`).toMatch(/i18nNamespace="news"/);
    expect(
      src,
      `${EDITOR_NOVINKY}: chybí i18nKeyScope — bez něj se klíče nerazí a článek ` +
        "zůstane jednojazyčný",
    ).toMatch(/i18nKeyScope=\{/);
  });

  it("editor plátna razí klíče před odečtením HTML a jen při ručním uložení", () => {
    const src = bezKomentaru(cti(PLATNO));
    expect(src).toMatch(/zajistiI18nKlice\(/);
    const razeni = src.indexOf("zajistiI18nKlice(");
    const getHtml = src.indexOf("editor.getHtml()");
    expect(
      razeni >= 0 && getHtml >= 0 && razeni < getHtml,
      "razítko musí předcházet getHtml(), jinak se uloží HTML bez klíčů",
    ).toBe(true);
    expect(
      src.slice(Math.max(0, razeni - 200), razeni),
      "razítko smí běžet jen při RUČNÍM uložení (automaticke === false)",
    ).toMatch(/!automaticke/);
  });

  it("prefix klíče se skládá z namespacu zápisu, ne z konstanty", () => {
    const src = cti(KLICE);
    expect(src, `${KLICE} neexistuje nebo je prázdný`).not.toBe("");
    expect(src).toMatch(/\$\{namespace\}\./);
    expect(
      /["'`](web|news|pages|extranet)\./.test(bezKomentaru(src)),
      "namespace v klíči nesmí být natvrdo — rozešel by se s namespacem zápisu " +
        "a PageRenderer (odvození z prvního segmentu klíče) by text nenašel",
    ).toBe(false);
  });

  it("razítko nedává klíč prvku, který obsahuje další prvky", () => {
    const src = cti(KLICE);
    expect(src).toMatch(/textnode/);
    expect(src).toMatch(/NETEXTOVE_TAGY|script/);
  });

  it("selhání nahrávání obrázku se ozve autorovi", () => {
    const src = bezKomentaru(cti(PLATNO));
    const od = src.indexOf("function obalNahravani");
    expect(
      od,
      "handler nahrávání musí jít do editoru OBALENÝ — bez obalu skončí výjimka " +
        "jako neodchycené odmítnutí promise (v konzoli, ne na obrazovce)",
    ).toBeGreaterThan(-1);

    const obal = src.slice(od, od + 700);
    expect(obal, "obal musí chybu zachytit").toMatch(/catch/);
    expect(obal, "obal musí chybu pojmenovat autorovi").toMatch(/toast\(/);
    expect(obal, "a pustit ji dál, aby se nepřidal obrázek, který nevznikl").toMatch(/throw/);

    expect(
      src,
      "do konfigurace editoru musí jít OBAL, ne surový handler",
    ).toMatch(/getPageEditorConfig\(undefined,\s*assetUpload \? obalNahravani/);
  });
});

describe("texty obsahu smí zapsat i staff", () => {
  it("upsert_translations pouští staff, ale jen obsahové namespacy", () => {
    const src = cti(UPSERT);
    expect(src).toMatch(/is_admin_or_staff/);
    expect(src, "seznam obsahových namespacu musí být deklarovaný").toMatch(
      /ARRAY\['web',\s*'news',\s*'pages',\s*'extranet'\]/,
    );
    expect(
      src,
      "mimo obsahové namespacy musí staff dostat odmítnutí, ne tiché přijetí",
    ).toMatch(/RAISE EXCEPTION 'Access denied: role staff/);
  });

  it("upsert_translations je zapojený v heals — jinak se změna k běžící DB nedostane", () => {
    expect(cti(HEALS)).toMatch(/\\ir sql\/functions\/upsert_translations\.sql/);
  });

  it("právo na článek a právo na jeho texty se nerozcházejí", () => {
    const policy = cti("aisha/db/sql/policies/Admin_staff_can_manage_news.sql");
    expect(policy).toMatch(/is_admin_or_staff\(\)/);
  });
});

describe("novinka je dohledatelná v knihovně", () => {
  it("hledání jde přes text bez značek, ne přes surové HTML", () => {
    const src = cti(LISTING);
    expect(src).toMatch(/public\.text_z_html\(tr\.value\)/);
    expect(
      /tr\.value ILIKE/.test(src),
      "hledání nesmí porovnávat surové HTML — dotaz „img“ by vracel celou knihovnu",
    ).toBe(false);
  });

  it("hledá se i v plátně (canvas_html), jinak nový článek z knihovny zmizí", () => {
    expect(cti(LISTING)).toMatch(/text_z_html\(na\.canvas_html\)/);
  });

  it("text_z_html je IMMUTABLE a není vystavený jako RPC", () => {
    const src = cti("aisha/db/sql/functions/text_z_html.sql");
    expect(src).toMatch(/\bIMMUTABLE\b/);
    expect(
      /GRANT EXECUTE ON FUNCTION public\.text_z_html/.test(src),
      "pomocník definer funkce nepotřebuje grant pro role API (a grant by ho " +
        "vystavil jako RPC, které pak brána db-types-cover-exposed-rpcs žádá v typech)",
    ).toBe(false);
  });

  it("text_z_html je v heals PŘED listingem, který ho volá", () => {
    const heals = cti(HEALS);
    const pomocnik = heals.indexOf("sql/functions/text_z_html.sql");
    const listing = heals.indexOf("sql/functions/get_published_news_articles_filtered.sql");
    expect(pomocnik, "text_z_html chybí v heals").toBeGreaterThan(-1);
    expect(listing).toBeGreaterThan(-1);
    expect(pomocnik < listing, "pomocník musí být zaveden před funkcí, která ho volá").toBe(true);
  });
});

describe("správa překladů ukáže každý namespace, který v datech je", () => {
  it("seznam namespacu se odvozuje z dat, není napsaný v kódu", () => {
    const src = bezKomentaru(cti(SPRAVA_PREKLADU));
    expect(
      /const NAMESPACES\s*=\s*\[/.test(src),
      "pevný seznam namespacu zastará: naměřeno 5 namespacu v kódu, které v něm " +
        "nebyly (news, common, notifications, subscription_packages, consent)",
    ).toBe(false);
    expect(src).toMatch(/new Set\(\s*\n?\s*translations/);
  });
});
