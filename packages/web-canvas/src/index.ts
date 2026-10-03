/**
 * @aisha/web-canvas — transformace plátna z editoru na HTML.
 *
 * ⛔ PROČ SDÍLENÝ BALÍČEK. Tutéž transformaci potřebují DVA konzumenti:
 * prohlížeč (PageRenderer) a generátor statických stránek (svc-web-render).
 * Kdyby ji každý dělal po svém, stránka by vypadala JINAK podle toho, jak na
 * ni návštěvník přišel — přímým načtením vs. proklikem uvnitř webu. To je
 * horší než pomalá stránka, protože je to nepravidelné a nikdo to nenahlásí.
 *
 * Balíček proto nese JEDINOU pravdu o tom, jak se z `canvas_html` stane
 * hotové HTML: rozřešení `data-i18n-key`, rozdělení na statické úseky
 * a runtime bloky, a sanitizace.
 *
 * DOM SE INJEKTUJE. Prohlížeč má `DOMParser`, Node ne — místo dvou cest
 * (DOM v prohlížeči, regex v Node) se parser PŘEDÁVÁ. Dvě cesty by totiž
 * znamenaly dva výsledky: regexová varianta neumí atributové vazby
 * (placeholder, title, aria-label), takže by generovaná stránka měla
 * nepřeložené atributy, které by prohlížeč po převzetí opravil — tedy
 * přesně ta nepravidelnost, kvůli které balíček vznikl.
 */

/** Atributy nesoucí klíč pro TEXTOVÝ obsah prvku. */
export const TEXT_I18N_KEY_ATTRS = ["data-i18n-key", "data-i18n"] as const;

/** Atributové vazby: klíč → atribut, do kterého se přeložená hodnota zapíše. */
export const ATTRIBUTE_I18N_BINDINGS = [
  { keyAttr: "data-i18n-placeholder-key", target: "placeholder" },
  { keyAttr: "data-i18n-title-key", target: "title" },
  { keyAttr: "data-i18n-aria-label-key", target: "aria-label" },
  { keyAttr: "data-i18n-alt-key", target: "alt" },
] as const;

const ALL_KEY_ATTRS = [
  ...TEXT_I18N_KEY_ATTRS,
  ...ATTRIBUTE_I18N_BINDINGS.map((b) => b.keyAttr),
];

const I18N_SELECTOR = ALL_KEY_ATTRS.map((a) => `[${a}]`).join(",");

const RUNTIME_BLOCK_ATTR = /\bdata-runtime-block="([^"]+)"/;
// ⛔ KONFIGURACE SMÍ BÝT V APOSTROFECH I V UVOZOVKÁCH (naměřeno 2026-09-03,
// audit U5-8). Seed píše `data-block-config='{"zpet":"/news"}'`, jenže
// GrapesJS při uložení atribut přepíše na `data-block-config="{&quot;zpet&quot;…}"`.
// Vzor jen s apostrofy pak konfiguraci NENAŠEL a blok se po prvním uložení
// v editoru vykreslil s výchozím nastavením — bez chyby, protože „žádná
// konfigurace" je platný stav. Entity `&quot;` se rozbalují níž při parsování.
const RUNTIME_BLOCK_CONFIG_ATTR = /\bdata-block-config=(?:'([^']*)'|"([^"]*)")/;
const DIV_TAG_REGEX = /<div\b([^>]*)>(?:<\/div>)?/g;

/**
 * Parser HTML. Prohlížeč předá `DOMParser`, Node jsdom — výsledek musí být
 * v obou případech TÝŽ, proto se nikde nepřepíná na regexovou náhražku.
 */
export type ParseHtml = (html: string) => Document;

export interface CanvasSegment {
  type: "html" | "runtime-block";
  html?: string;
  blockType?: string;
  blockConfig?: Record<string, unknown>;
  /**
   * Vyplněno, když konfigurace bloku nešla přečíst. Balíček ji NEUMÍ zalogovat
   * (nezná prostředí), ale nesmí ji ani spolknout — rozbitá konfigurace by
   * jinak tiše vyrobila výchozí blok a autor by netušil, proč jeho nastavení
   * nefunguje. Konzument rozhodne, jestli to hlásí do konzole, do Sentry
   * nebo do stavu editoru.
   */
  configError?: string;
}

/**
 * Vytáhne unikátní i18n klíče z už rozparsovaného dokumentu.
 *
 * ⛔ TŘI DETAILY, které NEJSOU libovolné (převzato z původního
 * svc-web-artifact/src/lib/i18nKeyExtractor.ts, který tahle funkce nahrazuje):
 *
 *  1. hledá v CELÉM dokumentu, ne jen v `body` — klíč může být i v hlavičce
 *  2. výstup se ŘADÍ, aby byl deterministický: ingest z něj skládá seznam
 *     k překladu a nestabilní pořadí by dělalo šum v diffech a snapshotech
 *  3. prázdný a whitespace klíč se zahazuje, ne přidává
 */
export function extractI18nKeysFromDocument(doc: Document): string[] {
  const keys = new Set<string>();
  doc.querySelectorAll(I18N_SELECTOR).forEach((el) => {
    for (const attr of ALL_KEY_ATTRS) {
      const key = el.getAttribute(attr)?.trim();
      if (key) keys.add(key);
    }
  });
  return Array.from(keys).sort();
}

/** Totéž z řetězce — parser se injektuje (prohlížeč DOMParser, Node jsdom). */
export function extractI18nKeys(html: string, parseHtml: ParseHtml): string[] {
  return extractI18nKeysFromDocument(parseHtml(html));
}

/**
 * Rozřešení jednoho klíče. Pořadí je nosné (vyhrává první zásah):
 *
 *   1. `translationsMap[key]` — hodnota z DB
 *   2. `fallback(key)` — statický katalog, ale JEN když opravdu něco našel;
 *      i18next při minutí vrací KLÍČ DOSLOVA, což je miss, ne hodnota
 *   3. `authored` — text, který autor napsal přímo do plátna
 *
 * ⚠️ Třetí vrstva vznikla z NAMĚŘENÉ vady: bez ní se `??` nad krokem 2 chovalo
 * jako úspěch i při minutí a návštěvníkovi se vykreslil syrový klíč jako
 * viditelný text. Nejhorší případ musí být „původní jazyk", ne „rozbitá
 * stránka".
 */
export function resolveTranslation(
  key: string,
  translationsMap: Record<string, string>,
  fallback: ((key: string) => string) | undefined,
  authored?: string,
): string {
  // ⛔ PRÁZDNÝ ŘETĚZEC Z DB JE ZÁSAH, ne minutí. Překladatel smí hodnotu
  // vědomě vyprázdnit (skrytý popisek), a `length > 0` by to přebilo textem
  // autora — tedy vrátilo obsah, který někdo záměrně odstranil.
  const fromDb = translationsMap[key];
  if (fromDb !== undefined && fromDb !== null) return fromDb;

  const fromCatalog = fallback ? fallback(key) : "";
  // Klíč zpátky = minutí, ne hodnota (i18next vrací klíč doslova).
  if (fromCatalog && fromCatalog !== key) return fromCatalog;

  if (authored !== undefined && authored !== "") return authored;

  // Poslední instance je katalogová hodnota i při minutí — tedy klíč. Radši
  // viditelný klíč než prázdný prvek, který v rozvržení nechá díru bez stopy.
  return fromCatalog;
}

/**
 * Překlad do ATRIBUTU nesmí nést značky — `placeholder="<b>x</b>"` by se
 * vykreslil doslova. Strhne se tedy všechno kromě textu a zmáčknou mezery.
 */
export function stripHtmlForAttribute(value: string, sanitize: Sanitize): string {
  return sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] } as never)
    .replace(/\s+/g, " ")
    .trim();
}

/** Nahradí obsah i atributy podle `data-i18n-*` a vrátí hotové HTML. */
export function resolveI18nInHtml(
  html: string,
  translationsMap: Record<string, string>,
  parseHtml: ParseHtml,
  sanitize: Sanitize,
  fallback?: (key: string) => string,
): string {
  const doc = parseHtml(html);
  doc.body.querySelectorAll(I18N_SELECTOR).forEach((el) => {
    for (const attr of TEXT_I18N_KEY_ATTRS) {
      const key = el.getAttribute(attr)?.trim();
      if (!key) continue;
      // Přiřazení do innerHTML je tu ZÁMĚRNÉ: překlad smí nést značky
      // (odkaz, <strong>), protože autor je tak napsal do plátna. Bezpečné
      // to dělá až `sanitizeCanvasHtml`, kterou MUSÍ volat každý konzument
      // před vložením do DOM — proto je v témž balíčku a se sdílenými volbami.
      el.innerHTML = resolveTranslation(key, translationsMap, fallback, el.innerHTML);
      break;
    }
    for (const binding of ATTRIBUTE_I18N_BINDINGS) {
      const key = el.getAttribute(binding.keyAttr)?.trim();
      if (!key) continue;
      el.setAttribute(
        binding.target,
        stripHtmlForAttribute(
          resolveTranslation(key, translationsMap, fallback, el.getAttribute(binding.target) ?? ""),
          sanitize,
        ),
      );
    }
  });
  return doc.body.innerHTML;
}

/**
 * Rozdělí HTML na statické úseky a runtime bloky.
 *
 * Blok je v plátně `<div data-runtime-block="…" data-block-config='…'>`.
 * Konfigurace nese VLASTNOSTI (co zobrazit), ne chování — logiku si veze
 * komponenta, kterou klient shipuje. Proto je množina typů uzavřená: kdyby
 * šla rozšířit z editoru, byl by to spouštěč libovolného kódu.
 */
/** Otevírací i uzavírací `<div>` — pro počítání hloubky uvnitř bloku. */
const DIV_PAROVA_ZNACKA = /<\/?div\b[^>]*>/gi;

/**
 * Najde konec bloku: od konce jeho otevírací značky počítá vnořené `<div>`
 * a vrátí index ZA odpovídajícím `</div>`. Když se párování nenajde, vrací
 * `null` — volající pak úsek NEBERE jako blok.
 *
 * ⛔ PROČ TO NELZE ODBÝT REGEXEM NA JEDNU ZNAČKU (naměřeno 2026-09-01).
 * Původní `/<div\b([^>]*)>(?:<\/div>)?/` spolklo `</div>` jen tehdy, když
 * hned sousedilo — tedy JEN u prázdného bloku. Blok s obsahem nechal svoje
 * děti i svoje `</div>` v následujícím statickém úseku a ten se tím rozvážil.
 * Na produkci to zavřelo obalový div sekce předčasně, prohlížeč strom
 * dorovnal a zástupný text bloku vypadl až nad patičku.
 */
function konecBlokovehoDivu(html: string, odIndexu: number): number | null {
  DIV_PAROVA_ZNACKA.lastIndex = odIndexu;
  let hloubka = 1;
  let z: RegExpExecArray | null;
  while ((z = DIV_PAROVA_ZNACKA.exec(html)) !== null) {
    hloubka += z[0].startsWith("</") ? -1 : 1;
    if (hloubka === 0) return z.index + z[0].length;
  }
  return null;
}

export function splitCanvasSegments(html: string): CanvasSegment[] {
  const segments: CanvasSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  DIV_TAG_REGEX.lastIndex = 0;

  while ((m = DIV_TAG_REGEX.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    const blockMatch = RUNTIME_BLOCK_ATTR.exec(attrs);
    if (!blockMatch) continue;

    // Prázdný blok si `</div>` odnesl už regex; jinak se dohledá párováním.
    const zaOteviraci = m.index + m[0].length;
    const konecUseku = m[0].endsWith("</div>")
      ? zaOteviraci
      : konecBlokovehoDivu(html, zaOteviraci);

    // ⛔ NEPÁROVÝ DIV SE NEBERE JAKO BLOK. Bez konce se nedá říct, kde blok
    // končí, a každá volba by obsah buď zahodila, nebo přehodila. Úsek proto
    // zůstane statický: blok se nevykreslí — což je vidět a dá se opravit —
    // ale nic se neztratí a nic se nepřehází.
    if (konecUseku === null) continue;

    if (m.index > last) segments.push({ type: "html", html: html.slice(last, m.index) });

    let blockConfig: Record<string, unknown> = {};
    let configError: string | undefined;
    const cfg = RUNTIME_BLOCK_CONFIG_ATTR.exec(attrs);
    const cfgText = cfg?.[1] ?? cfg?.[2];
    if (cfgText) {
      try {
        // Konfigurace z plátna je VSTUP: rozbitý JSON nesmí shodit stránku,
        // blok se v tom případě vykreslí s výchozím nastavením — ALE musí
        // to být vidět, jinak autor marně hledá, proč jeho nastavení nefunguje.
        blockConfig = JSON.parse(cfgText.replace(/&quot;/g, '"')) as Record<string, unknown>;
      } catch (err) {
        blockConfig = {};
        configError = err instanceof Error ? err.message : String(err);
      }
    }
    segments.push({
      type: "runtime-block",
      blockType: blockMatch[1],
      blockConfig,
      ...(configError ? { configError } : {}),
    });
    // Blok pohltí CELÝ svůj podstrom. Obsah uvnitř je zástupný náhled pro
    // editor (aby v plátně nebyl prázdný rámeček) — za běhu ho nahradí
    // komponenta, takže do statického úseku nepatří.
    last = konecUseku;
    DIV_TAG_REGEX.lastIndex = last;
  }

  if (last < html.length) segments.push({ type: "html", html: html.slice(last) });
  return segments;
}

/**
 * Nastavení sanitizace. ⛔ MUSÍ BÝT SPOLEČNÉ pro oba konzumenty — jinak by
 * generátor a prohlížeč propustily jinou množinu značek a stránka by se
 * lišila podle způsobu příchodu, tedy přesně to, kvůli čemu balíček vznikl.
 */
export const SANITIZE_OPTS = {
  ADD_ATTR: [
    ...ALL_KEY_ATTRS,
    ...ATTRIBUTE_I18N_BINDINGS.map((b) => b.target),
    "data-gjs-type",
    "data-template",
    "data-runtime-block",
    "data-block-config",
  ],
  ADD_TAGS: ["style"],
  ALLOW_DATA_ATTR: true,
};

/**
 * ⛔ VÝSTUP `resolveI18nInHtml` NENÍ BEZPEČNÝ SÁM O SOBĚ. Překlad může
 * pocházet z databáze i z textu, který autor napsal do plátna — obojí je
 * VSTUP. Než se HTML dostane do DOM, musí projít TOUHLE funkcí; obě strany
 * (generátor i prohlížeč) používají tytéž volby, aby výsledek byl týž.
 *
 * Sanitizér se injektuje ze stejného důvodu jako parser: prohlížeč má
 * DOMPurify nad window, Node ho potřebuje nad jsdom.
 */
export type Sanitize = (html: string, opts: typeof SANITIZE_OPTS) => string;

export function sanitizeCanvasHtml(html: string, sanitize: Sanitize): string {
  return sanitize(html, SANITIZE_OPTS);
}

export function hasRuntimeBlocks(html: string): boolean {
  return /\bdata-runtime-block="/.test(html);
}

/* ─────────────────────────── ÚTRŽKY (partials) ─────────────────────────── */

/**
 * Značka místa, kam se vkládá sdílený útržek: `<div data-partial="nav"></div>`.
 *
 * ⛔ PROČ NE `data-runtime-block`. Runtime blok je KOMPONENTA — kód, který
 * platforma shipuje, s uzavřenou množinou typů a bránou nad třemi seznamy.
 * Útržek je OBSAH: HTML, které autor napsal v témž editoru, jen jednou místo
 * desetkrát. Kdyby se to slilo do jednoho mechanismu, musel by generátor umět
 * spustit React, aby dostal do statické stránky hlavičku — což je přesně to,
 * čemu se tenhle balíček vyhýbá.
 */
const PARTIAL_TAG_REGEX = /<div\b[^>]*\bdata-partial="([^"]+)"[^>]*>\s*<\/div>|<div\b[^>]*\bdata-partial="([^"]+)"[^>]*\/>/g;

export interface PartialExpansion {
  html: string;
  /** Odkazy, ke kterým útržek neexistoval. Konzument je zaloguje. */
  missing: string[];
}

/**
 * Dosadí sdílené útržky do plátna.
 *
 * ⛔ MUSÍ BĚŽET PŘED PŘEKLADEM. Útržek si nese vlastní `data-i18n-key`
 * (`web.nav.home`), takže kdyby se dosazoval až po `resolveI18nInHtml`,
 * zůstala by navigace nepřeložená — a v prohlížeči by ji dorovnal až druhý
 * průchod, tedy viditelný přeskok.
 *
 * ⛔ JEDNA ÚROVEŇ, ZÁMĚRNĚ. Útržek uvnitř útržku se už nerozbaluje: rekurze
 * by potřebovala detekci cyklů a autor by si dvěma odkazy na sebe navzájem
 * uměl zavěsit vykreslování. Jedna úroveň je dokazatelně konečná a pokrývá
 * to, k čemu útržky jsou — hlavička a patička sdílená napříč stránkami.
 *
 * ⛔ CHYBĚJÍCÍ ÚTRŽEK SE HLÁSÍ, NEMIZÍ. Tiché odstranění značky by vypadalo
 * jako stránka bez hlavičky, tedy jako záměr autora. `missing` proto nese
 * odkazy, které se nenašly, a konzument rozhodne, jestli to zaloguje nebo
 * (v generátoru) odmítne vydat stránku.
 */
export function expandPartials(
  html: string,
  partials: Record<string, string>,
): PartialExpansion {
  const missing: string[] = [];
  PARTIAL_TAG_REGEX.lastIndex = 0;
  const out = html.replace(PARTIAL_TAG_REGEX, (cely, a?: string, b?: string) => {
    const ref = (a ?? b ?? "").trim();
    if (!ref) return cely;
    const telo = partials[ref];
    if (telo === undefined) {
      missing.push(ref);
      // Značka zůstává v HTML: prázdný <div> je stopa, po které se chyba
      // dohledá. Odstranit ji by znamenalo zahladit důkaz.
      return cely;
    }
    return telo;
  });
  return { html: out, missing };
}

/** Nese plátno odkaz na útržek? Levná otázka pro konzumenty, co chtějí přeskočit načtení. */
export function hasPartials(html: string): boolean {
  return /\bdata-partial="/.test(html);
}
