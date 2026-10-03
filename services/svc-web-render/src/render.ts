/**
 * render — z publikovaných stránek v DB vyrobí STATICKÉ HTML.
 *
 * ⛔ PROČ TAHLE SLUŽBA EXISTUJE (naměřeno 2026-08-30 na jedné z instancí).
 *
 * Veřejný web byl prázdná SPA skořápka:
 *
 *   HTML první odpovědi   ~2 kB (bez obsahu)
 *   blokující CSS         40 kB gzip
 *   JS, než se objeví text  3,1 MB gzip / 9,2 MB rozbaleno
 *   HTML+CSS samotné homepage  153 kB → 96 kB gzip
 *
 * Obsah, který má návštěvník vidět, je padesátkrát menší než to, co na něj
 * čeká. Tenhle generátor pořadí obrací: HTML vyrobí dopředu, takže PRVNÍ
 * vykreslení JE hotový design a SPA se převezme až potom.
 *
 * Tři věci, které to celé drží a bez kterých by se výsledek tiše zhoršil:
 *
 *  1) OBRÁZKY VEN Z BASE64. 69 % homepage byly `data:` URI. Vytažením do
 *     souborů spadne první odpověď z 96 kB na 17,7 kB gzip — a obrázky se
 *     pak stahují paralelně a cachují se zvlášť místo s každou změnou textu.
 *
 *  2) STYLESHEETY SPA NEBLOKUJÍCÍ. Statická stránka si veze vlastní CSS
 *     inline; kdyby se čekalo ještě na 40 kB CSS aplikace, zdrželo by přesně
 *     to vykreslení, které má být okamžité.
 *
 *  3) STATICKÝ OBSAH MIMO #root. `createRoot().render()` kontejner VYPRÁZDNÍ,
 *     takže obsah v #root by při startu Reactu zmizel a znovu se objevil.
 *     Leží proto v sourozeneckém #static-page, který aplikace odstraní teprve
 *     až vykreslí totéž. Když JS nikdy nedojede, statická stránka zůstane —
 *     web funguje i bez JavaScriptu.
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Přípony podle MIME z `data:` URI — jiné formáty se nechají inline. */
const PRIPONY: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

const DATA_URI = /data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)/gi;

/**
 * Vytáhne `data:` obrázky do souborů a vrátí HTML s přepsanými odkazy.
 * Jméno = hash obsahu, takže soubor smí mít `immutable` cache a při změně
 * textu se znovu nestahuje.
 */
export async function vytahniObrazky(
  html: string,
  adresarObrazku: string,
  verejnaCesta: string,
): Promise<{ html: string; pocetObrazku: number }> {
  const zapsat = new Map<string, Buffer>();
  const prepsane = html.replace(DATA_URI, (cele, mime, b64) => {
    const pripona = PRIPONY[mime.toLowerCase()];
    if (!pripona) return cele; // neznámý typ zůstane inline — radši větší než rozbitý
    const data = Buffer.from(b64, "base64");
    const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
    const jmeno = `${hash}.${pripona}`;
    zapsat.set(jmeno, data);
    return `${verejnaCesta}/${jmeno}`;
  });
  if (zapsat.size > 0) {
    await mkdir(adresarObrazku, { recursive: true });
    for (const [jmeno, data] of zapsat) {
      await writeFile(join(adresarObrazku, jmeno), data);
    }
  }
  return { html: prepsane, pocetObrazku: zapsat.size };
}

/** Escapuje text do HTML atributu i textového uzlu. */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Ze skořápky aplikace (dist/index.html) vytáhne značky, které SPA potřebuje.
 * ⛔ Nesmí se hádat z názvů souborů — Vite je hashuje při každém buildu.
 * Jediný spolehlivý zdroj je skořápka, kterou týž build vydal.
 */
export interface Skorapka {
  skripty: string[];
  styly: string[];
  ostatniHlava: string[];
}

export function rozeberSkorapku(indexHtml: string): Skorapka {
  const skripty = [...indexHtml.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/gi)]
    .map((m) => m[0]);
  const styly = [...indexHtml.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)].map((m) => m[0]);
  const ostatniHlava = [...indexHtml.matchAll(/<link\b(?![^>]*rel="stylesheet")[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /rel="(icon|apple-touch-icon|manifest)"/i.test(t));
  return { skripty, styly, ostatniHlava };
}

/**
 * Udělá ze stylesheetu neblokující. `media="print"` prohlížeč stáhne, ale
 * nečeká na něj s vykreslením; `onload` ho pak vrátí do hry.
 * `<noscript>` kopie zajistí, že bez JS se styl aplikace uplatní normálně.
 */
/**
 * ⛔ ŽÁDNÝ VLOŽENÝ `onload` — CSP HO ZAKÁŽE (naměřeno 2026-09-03 na produkci).
 *
 * Dřívější trik `media="print" onload="this.media='all'"` přepínal stylesheet
 * aplikace na obrazovku až po stažení, aby neblokoval první vykreslení.
 * Jenže edge posílá `script-src 'self' 'wasm-unsafe-eval'` — bez nonce a bez
 * 'unsafe-inline' — takže prohlížeč vložený handler odmítne, stylesheet
 * zůstane `print` a všechno, co po hydrataci vykreslí React (pruh zkušebního
 * provozu, lišta souhlasu, vnitřky runtime bloků), přijde o Tailwind: Arial,
 * šedá nativní tlačítka, žádné zaoblení. Na 30 z 30 načtení 10 stránek.
 * Holý `<link>` v `<noscript>` tomu nepomohl — ten platí jen bez JS.
 *
 * Řešení bez skriptu: holý `<link rel="stylesheet">` na KONCI těla. CSS
 * stránky je inline v hlavě, takže první vykreslení nečeká; stylesheet na
 * konci těla blokuje jen obsah ZA sebou — a za ním nic není. Aplikace ho
 * dostane dřív, než se hydratuje (35 kB komprimovaně, naměřeno).
 */
function neblokujici(linkTag: string): string {
  return linkTag.replace(/\s+media="[^"]*"/gi, "");
}

/**
 * Poskládá statické HTML jedné stránky.
 *
 */
export interface StrankaKeSlozeni {
  slug: string;
  title: string;
  description: string;
  canvasHtml: string;
  canvasCss: string;
  ogImage?: string;
}

export interface Branding {
  primary?: string;
  lang?: string;
}

/**
 * Rozbor odpovědi `get_branding_for_hostname` na branding pro první vykreslení.
 *
 * ⛔ NAMĚŘENO 2026-09-20: čtečka brala `color_primary` a `default_locale`
 * z NEJVYŠŠÍ úrovně, ale ta funkce je vrací VNOŘENÉ v klíči `profile`
 * (aisha/db/sql/functions/get_branding_for_hostname.sql: `jsonb_build_object(…,
 * 'profile', v_profile)`, barva uvnitř `v_profile`). Obojí proto vycházelo
 * undefined a tichým následkem bylo `lang="en"` na KAŽDÉ stránce a první
 * vykreslení bez barvy značky. Nic nespadlo: generátor vydal validní stránky,
 * jen v cizím jazyce — u veřejného webu to kazí SEO i čtečky obrazovky.
 *
 * Plochý tvar se čte dál jako záloha: kdyby některá instance nebo starší verze
 * funkce vracela hodnoty na vršku, nemá smysl ji rozbít. Oba tvary hlídá test.
 */
export function barvaZOdpovedi(odpoved: unknown): string {
  const r = Array.isArray(odpoved) ? odpoved[0] : odpoved;
  const vrchol = (r && typeof r === "object" ? r : {}) as {
    color_primary?: unknown;
    profile?: unknown;
  };
  const profil = (vrchol.profile ?? {}) as { color_primary?: unknown };
  const barva = profil.color_primary ?? vrchol.color_primary;
  return typeof barva === "string" ? barva : "";
}

/**
 * Výchozí jazyk instance z odpovědi `get_supported_languages()`.
 *
 * ⛔ TENTO ZDROJ, a ne `commerce_base_locale()`. Oba existují a oba tvrdí, že
 * jsou „ten jediný" — ale jazyk, který SPRAVUJE ADMINISTRACE a kterým se řídí
 * samotná aplikace, je `supported_languages` (RPC řadí `is_default DESC`,
 * čte to `useActiveLocales`). `commerce_base_locale()` je v platformě
 * deklarovaná, zdokumentovaná jako jediná pravda — a NIKDO ji nevolá (měřeno
 * 2026-09-20: v celém repu jen definice, seed a generované DB typy).
 *
 * Proč na tom záleží: předgenerovaná stránka a hydratovaná SPA MUSÍ sáhnout na
 * týž zdroj. Kdyby statické HTML vzalo jazyk odjinud než přepínač v aplikaci,
 * stránka by po hydrataci přeskočila do jiného jazyka — a crawler i nakupující
 * agent by si uložili tu verzi, kterou SPA vzápětí zahodí.
 */
export function vychozíJazyk(odpoved: unknown): string {
  const rows = Array.isArray(odpoved) ? odpoved : odpoved == null ? [] : [odpoved];
  for (const row of rows) {
    if (typeof row === "string" && row.trim() !== "") return row.trim();
    if (row && typeof row === "object") {
      const kod = (row as { code?: unknown }).code;
      if (typeof kod === "string" && kod.trim() !== "") return kod.trim();
    }
  }
  return "";
}

export function slozStranku({
  stranka,
  branding,
  skorapka,
  kanonickaUrl,
}: {
  stranka: StrankaKeSlozeni;
  branding: Branding;
  skorapka: Skorapka;
  kanonickaUrl?: string;
}): string {
  const lang = branding.lang || "en";
  const primary = branding.primary || "";
  // Barva prvního vykreslení: bez ní drží --primary platformní oranžovou
  // z index.css a načítací stav svítí cizí barvou. Formát je HOLÁ HSL
  // trojice — dosazuje se dovnitř hsl(var(--primary)), hex by se tiše rozbil.
  const barvyBloku = primary
    ? `\n    <style>:root{--primary:${primary};--ring:${primary};--brand:${primary}}</style>`
    : "";

  return `<!doctype html>
<html lang="${esc(lang)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(stranka.title)}</title>
    <meta name="description" content="${esc(stranka.description)}" />
    <meta property="og:title" content="${esc(stranka.title)}" />
    <meta property="og:description" content="${esc(stranka.description)}" />
    <meta property="og:type" content="website" />${
      kanonickaUrl ? `\n    <link rel="canonical" href="${esc(kanonickaUrl)}" />` : ""
    }${stranka.ogImage ? `\n    <meta property="og:image" content="${esc(stranka.ogImage)}" />` : ""}
    ${skorapka.ostatniHlava.join("\n    ")}${barvyBloku}
    <!--
      CSS stránky INLINE: první vykreslení nesmí čekat na síť. Stylesheety
      aplikace jdou níž a neblokujícím způsobem — ony patří SPA, ne téhle
      stránce.
    -->
    <style>${stranka.canvasCss}</style>
    <!--
      ⛔ POJISTKA PROTI DVOJÍ STRÁNCE (naměřeno 2026-09-03: každá
      předrenderovaná stránka byla na produkci dvakrát pod sebou — statická
      kopie nahoře, hydratovaná pod ní, 2697 px na indexu). Aplikace statickou
      kopii odstraní sama (PageRenderer), tohle je řádek pro případ, že by
      efekt přišel pozdě nebo se nespustil: jakmile je v #root cokoli,
      #static-page zmizí. Bez JS zůstává #root prázdný a stránka viditelná.
    -->
    <style>body:has(#root:not(:empty)) #static-page{display:none}</style>
  </head>
  <body>
    <!--
      ⛔ Statický obsah MIMO #root: createRoot().render() kontejner vyprázdní,
      takže tady by při startu Reactu zmizel a znovu se objevil. Aplikace
      #static-page odstraní teprve až vykreslí totéž (PageRenderer).
      Bez JS zůstane — web funguje i tak.
    -->
    <div id="static-page" data-slug="${esc(stranka.slug)}">${stranka.canvasHtml}</div>
    <div id="root"></div>
    ${skorapka.styly.map(neblokujici).join("\n    ")}
    ${skorapka.skripty.join("\n    ")}
  </body>
</html>
`;
}

/** Cesta souboru pro slug: `index` → /index.html, jinak /<slug>/index.html. */
export function cestaProSlug(korenVystupu: string, slug: string): string {
  return slug === "index"
    ? join(korenVystupu, "index.html")
    : join(korenVystupu, slug, "index.html");
}

/** Zapíše stránku na disk (včetně adresáře). */
export async function zapisStranku(
  korenVystupu: string,
  slug: string,
  html: string,
): Promise<string> {
  const cesta = cestaProSlug(korenVystupu, slug);
  await mkdir(dirname(cesta), { recursive: true });
  await writeFile(cesta, html, "utf8");
  return cesta;
}

/**
 * Uklidí stránky, které v DB už nejsou.
 * ⛔ Bez tohohle by odpublikovaná stránka zůstala na webu viset jako statický
 * soubor — nginx by ji dál servíroval a nikdo by se to nedozvěděl.
 */
export async function uklidOsirele(
  korenVystupu: string,
  aktualniSlugy: string[],
): Promise<number> {
  const zive = new Set(aktualniSlugy);
  let smazano = 0;
  // Dirent[], ne Awaited<ReturnType<…>>: ten vybere přetížení vracející
  // Buffer[] a `p.name` je pak Buffer, ne string.
  let polozky: Dirent[];
  try {
    polozky = await readdir(korenVystupu, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const p of polozky) {
    if (!p.isDirectory()) continue;
    if (p.name === "_img") continue; // obrázky se uklízejí zvlášť (sdílené mezi stránkami)
    if (!zive.has(p.name)) {
      await rm(join(korenVystupu, p.name), { recursive: true, force: true });
      smazano += 1;
    }
  }
  return smazano;
}
