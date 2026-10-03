/**
 * svc-web-render — GENERICKÝ generátor statického HTML publikovaných stránek.
 *
 * ⛔ PROČ EXISTUJE. Veřejný web každé AISHA instance je dnes prázdná SPA
 * skořápka: prohlížeč stáhne celý balík JS a teprve pak se aplikace zeptá na
 * obsah stránky. Naměřeno 2026-08-30 na jedné z instancí:
 *
 *   HTML první odpovědi      ~2 kB (bez obsahu)
 *   blokující CSS            40 kB gzip
 *   JS, než se objeví text   3,1 MB gzip
 *   HTML+CSS jedné stránky   153 kB → 96 kB gzip
 *
 * Obsah, který má návštěvník vidět, je řádově menší než to, co na něj čeká.
 * Tahle služba pořadí obrací: HTML vyrobí dopředu, takže PRVNÍ vykreslení JE
 * hotový design a SPA se převezme až potom.
 *
 * ⛔ NEJMENUJE ŽÁDNOU INSTANCI. Hostname se odvozuje z `APP_DOMAIN`, které
 * vydává topologický resolver; stránky, značku i překlady si služba vyzvedne
 * podle něj. Funguje tedy v každé instanci beze změny kódu — a smysl dává
 * i upstream, protože prázdná skořápka není vada jedné instance, ale vlastnost
 * architektury.
 *
 * ČERSTVOST MÁ DVĚ CESTY, a to schválně:
 *   PUSH          editor uloží → POST /render → přepíše jednu stránku (~1 s)
 *   ZÁCHYTNÁ SÍŤ  periodicky se ověří razítko max(updated_at) a při změně
 *                 se přegeneruje
 * Push sám má tichý režim selhání: ztratí-li se signál, stránka zůstane stará
 * a NIKDO se to nedozví. Záchytná síť navíc pokryje druhou cestu, kterou se
 * canvas mění (apply_web_artifact_to_page), i instanční seedy.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { chybejiciKlice, radkyNaMapu } from "./preklady.js";

import { applySecurity } from "@aisha/security";
// ⛔ TÁŽ TRANSFORMACE JAKO V PROHLÍŽEČI. Kdyby generátor překládal `data-i18n-key`
// po svém, statická stránka by nesla jiný text než tatáž stránka vykreslená
// SPA při prokliku — a rozdíl by závisel na tom, jak na ni návštěvník přišel.
import {
  SANITIZE_OPTS,
  expandPartials,
  extractI18nKeysFromDocument,
  resolveI18nInHtml,
  sanitizeCanvasHtml,
} from "@aisha/web-canvas";
import { createSsrfGuard } from "@aisha/security/ssrf";
import Fastify from "fastify";
import createDOMPurify from "isomorphic-dompurify";
import { JSDOM } from "jsdom";
import pino from "pino";

import { requireService } from "./auth.js";
import { loadConfig, type WebRenderConfig } from "./config.js";
import {
  rozeberSkorapku,
  slozStranku,
  uklidOsirele,
  vytahniObrazky,
  zapisStranku,
  barvaZOdpovedi,
  type Branding,
  vychozíJazyk,
} from "./render.js";

const SLUZBA = "svc-web-render";
const VEREJNA_CESTA_OBRAZKU = "/_img";

const log = pino({ name: SLUZBA });

/**
 * Parser a sanitizér pro Node. V prohlížeči je dodá DOMParser a DOMPurify nad
 * window; tady jsdom. Musí to být TÁŽ cesta (DOM, ne regex), jinak by se
 * výstupy lišily v atributových vazbách — placeholder, title, aria-label.
 */
const parseHtml = (html: string): Document =>
  new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const sanitize = ((html: string, opts: never) =>
  createDOMPurify.sanitize(html, opts)) as never;

interface IndexRadek {
  slug: string;
  updated_at: string;
}

/** Řádek `get_published_web_partials` — sdílený útržek (hlavička, patička). */
interface UtrzekZDb {
  ref: string;
  canvas_html: string | null;
  canvas_css: string | null;
}

interface StrankaZDb {
  title_key?: string;
  description_key?: string;
  canvas_html?: string;
  canvas_css?: string;
  og_image_url?: string;
}

/**
 * ⛔ HOLÝ fetch() SE TU NESMÍ. Adresa API přichází z konfigurace, takže cíl
 * volání je vstup — a nechráněné volání by ze služby udělalo odrazový můstek
 * do vnitřní sítě (SSRF). Stráž pinuje rozřešenou IP a hlídá allowlist hostů,
 * který je odvozený z TÉŽE konfigurace, ze které se bere URL: povolený je
 * právě jeden host, ten nakonfigurovaný.
 */
let ssrf: ReturnType<typeof createSsrfGuard> | null = null;
function guard(cfg: WebRenderConfig) {
  if (!ssrf) {
    ssrf = createSsrfGuard({
      service: SLUZBA,
      hostAllowlist: [new URL(cfg.apiUrl).hostname],
      // ⛔ MESH JE VNITŘNÍ SÍŤ. API se v této topologii volá po meshi
      // (`…mesh.<instance>.internal`), který se rozřeší do 100.64.0.0/10 —
      // rozsahu, jenž stráž bez tohohle příznaku blokuje. Naměřeno 2026-08-31:
      // `SsrfBlockedError: Resolved IP blocked` na mesh adrese API.
      //
      // Neotvírá to dveře: allowlist hostů výš pouští PRÁVĚ JEDEN host, ten
      // nakonfigurovaný, a `isBlockedIp` i s tímhle příznakem dál blokuje
      // loopback, 0.0.0.0/8, multicast a — hlavně — 169.254.x, tedy metadata
      // cloudu. Ověřeno čtením packages/security/src/ssrf.ts, ne podle komentáře.
      //
      // Týž postup jako u svc-plugin-system (MinIO uvnitř clusteru), svc-knock
      // a svc-matrix.
      allowInternalNetworks: true,
      // ⛔ `http:` PRO MESH, ne obecně. Mesh-ingress rozvádí API na portu
      // služby BEZ TLS — šifrování obstarává WireGuard pod tím, takže `https`
      // na mesh adrese nikdo neposlouchá (naměřeno 2026-09-01: :443
      // „Connection refused", :3001 vrátilo profil značky). Stráž ale povoluje
      // jen `https:` a odmítla to jako `SsrfBlockedError: Scheme not allowed`.
      //
      // Sama stráž s tímhle případem počítá — vlastní dokumentace
      // (`packages/security/src/ssrf.ts`) uvádí „plus `http:` pro
      // mesh-internal service-to-service when explicitly enabled". Tohle je to
      // výslovné povolení.
      //
      // Nerozšiřuje to plochu: `hostAllowlist` výš pouští PRÁVĚ JEDEN host —
      // ten nakonfigurovaný — takže `http` platí jen pro něj, ne pro internet.
      // `https:` zůstává povolené, aby konfigurace mimo mesh dál fungovala.
      allowedSchemes: ["https:", "http:"],
    });
  }
  return ssrf;
}

async function rpc<T>(cfg: WebRenderConfig, jmeno: string, telo: unknown): Promise<T> {
  const r = await guard(cfg).safeFetch(`${cfg.apiUrl}/rest/v1/rpc/${jmeno}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
    },
    body: JSON.stringify(telo ?? {}),
  });
  if (!r.ok) throw new Error(`${jmeno} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Překlady titulků a popisů. RPC chce SEZNAM KLÍČŮ (`p_keys text[]`), ne
 * jmenný prostor — volá se proto až po načtení stránek, jedním voláním pro
 * všechny. Selhání není fatální: bez překladu se zobrazí klíč, což je
 * viditelná a opravitelná vada, ne prázdná stránka.
 */
async function nactiPreklady(
  cfg: WebRenderConfig,
  klice: string[],
  locale: string,
): Promise<Record<string, string>> {
  if (klice.length === 0) return {};
  // ⛔ RPC vrací POLE řádků {key, value}, ne mapu (naměřeno 2026-09-03).
  // Dřív se odpověď brala jako Record a každé čtení vracelo undefined —
  // 10 stránek odešlo s klíčem v <title>. Převod se ověřuje (preklady.ts).
  //
  // Selhání RPC ani chybný tvar se NEschovávají do prázdné mapy: prázdná mapa
  // by znamenala „všechny klíče chybí" a generátor by stránky přeskočil
  // s vysvětlením u KAŽDÉ z nich. Radši jedna chyba s pravou příčinou.
  const data = await rpc<unknown>(cfg, "get_translations_map_with_fallback", {
    p_keys: klice,
    p_namespace: "web",
    p_locale: locale,
    p_fallback_locale: "en",
  });
  return radkyNaMapu(data);
}

async function nactiBranding(cfg: WebRenderConfig): Promise<Branding> {
  try {
    const r = await rpc<unknown>(cfg, "get_branding_for_hostname", { p_hostname: cfg.hostname });
    // ⛔ JAZYK NENÍ SOUČÁSTÍ BRANDINGU. `branding_profiles` žádný sloupec
    // s jazykem nemá a `get_branding_for_hostname` ho nevrací — dřív se tady
    // čekal `default_locale`, což byla NEEXISTUJÍCÍ hodnota, takže `lang`
    // vycházel vždy "en" a s ním se tahaly i VŠECHNY překlady (níž
    // `nactiPreklady(..., branding.lang)`). Předgenerovaná verze českého webu
    // tak byla fakticky anglická, aniž co spadlo.
    //
    // Jazyk se proto bere ZE STEJNÉHO ZDROJE, jaký používá aplikace:
    // `get_supported_languages()` (řadí `is_default DESC`), tedy to, co
    // spravuje administrace. Ne `commerce_base_locale()` — ta je sice
    // zdokumentovaná jako jediná pravda, ale v platformě ji nikdo nevolá.
    // Podrobně u `vychozíJazyk` v render.ts. Barvu rozebírá `barvaZOdpovedi`
    // (je VNOŘENÁ v klíči `profile`), jazyk `vychozíJazyk` — dvě funkce podle
    // dvou zdrojů, ne jedna se dvěma parametry (nález z cizího review).
    const jazyk = await rpc<unknown>(cfg, "get_supported_languages", {});
    return { primary: barvaZOdpovedi(r), lang: vychozíJazyk(jazyk) };
  } catch (err) {
    // Branding je jen barva prvního vykreslení. Bez něj se stránka vydá bez
    // barevného bloku a runtime branding ji dobarví — nesmí to shodit obsah.
    log.warn(
      { err: String(err).slice(0, 160) },
      "branding nebo jazyk se nenačetl — bez jazyka se nepředgeneruje nic",
    );
    return { primary: "", lang: "" };
  }
}

export async function vygeneruj(
  cfg: WebRenderConfig,
  { jenSlug }: { jenSlug?: string } = {},
): Promise<{ vyrobeno: number; razitko: string }> {
  const zacatek = Date.now();

  // ⛔ Skořápka se ČTE, nehádá: Vite hashuje jména chunků při každém buildu
  // (`shared-BL9zUP3B.js`), takže vepsaná jména by po prvním rebuildu
  // odkazovala na neexistující soubory a SPA by se nikdy nepřevzala.
  // Cesta pochází z nasazovací konfigurace (WEB_RENDER_SHELL), ne ze vstupu
  // uživatele; do kontejneru je navíc připojený jediný read-only volume se
  // skořápkou, takže traversal nemá kam vést. Literál sem dát nelze —
  // umístění skořápky je fakt o nasazení a hádat ho zakazuje brána o identitě.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const skorapka = rozeberSkorapku(await readFile(cfg.shellPath, "utf8"));
  if (skorapka.skripty.length === 0) {
    // Radši nic než web, který vypadá hotově, ale je mrtvý.
    throw new Error(`skořápka ${cfg.shellPath} nemá žádné <script> — build je rozbitý`);
  }

  const branding = await nactiBranding(cfg);
  if (!branding.lang) {
    // ⛔ Radši nepředgenerovat nic než vydat celý web v cizím jazyce. Bez
    // statických stránek spadne nginx na SPA fallback (docker/nginx.conf:
    // try_files … /index.html), která si jazyk vyřeší sama — návštěvník tedy
    // dostane správný obsah, jen o vykreslení později. Tiše vydané anglické
    // stránky by naopak nikdo nepoznal: nic nespadne, jen web mluví cizí řečí
    // a crawler i agent si ho tak uloží.
    // ⛔ HLÁŠKA MUSÍ UKÁZAT NA ZDROJ, ZE KTERÉHO SE ČTE. Stálo tu
    // „commerce_base_locale v system_config" — tedy právě ta funkce, kterou
    // tenhle commit vědomě ZAVRHL, protože ji nikdo nevolá. Kdo by tu chybu
    // viděl v provozu, ladil by prázdnou tabulku system_config místo nabídky
    // jazyků. Táž třída jako původní vada (ukazuje jinam, než kde problém je),
    // jen v textu místo v datech; našel to cizí review.
    throw new Error(
      "instance nemá deklarovaný žádný aktivní jazyk: get_supported_languages() " +
        "nevrátila ani jeden řádek s `code` (tabulka supported_languages, " +
        "is_active = true, výchozí je is_default) — nepředgenerovává se nic, " +
        "obsah servíruje SPA",
    );
  }
  const index = await rpc<IndexRadek[]>(cfg, "get_published_web_page_index", {
    p_hostname: cfg.hostname,
  });
  const slugy = (index ?? []).map((r) => r.slug);
  const razitko = (index ?? []).reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
  const kCilu = jenSlug ? slugy.filter((s) => s === jenSlug) : slugy;

  // ⛔ ÚTRŽKY JEDNÍM DOTAZEM, PŘED VŠÍM OSTATNÍM. Hlavička a patička jsou
  // sdílený obsah (`page_settings.role = 'partial'`), který stránky vkládají
  // značkou `<div data-partial="nav">`. Dosazují se PŘED extrakcí klíčů,
  // protože si nesou vlastní `data-i18n-key` — kdyby se rozbalily až po
  // překladu, byla by navigace ve statické stránce nepřeložená a prohlížeč
  // by ji po převzetí opravil, tedy viditelný přeskok.
  const utrzkyRows = await rpc<UtrzekZDb[]>(cfg, "get_published_web_partials", {
    p_hostname: cfg.hostname,
  });
  const utrzky: Record<string, string> = {};
  for (const u of utrzkyRows ?? []) utrzky[u.ref] = u.canvas_html ?? "";

  const stranky: Array<{ slug: string; p: StrankaZDb; html: string }> = [];
  for (const slug of kCilu) {
    const rows = await rpc<StrankaZDb[]>(cfg, "get_web_page_by_slug", {
      p_slug: slug,
      p_hostname: cfg.hostname,
    });
    const p = Array.isArray(rows) ? rows[0] : (rows as StrankaZDb | undefined);
    if (!p) continue;
    const { html, missing } = expandPartials(p.canvas_html ?? "", utrzky);
    if (missing.length > 0) {
      // ⛔ CHYBĚJÍCÍ ÚTRŽEK JE DŮVOD NEVYDAT, ne varování. Statická stránka
      // bez hlavičky vypadá hotově a nikdo ji nenahlásí — na rozdíl od
      // stránky, která se nevyrobila vůbec. Radši chybějící soubor (návštěvník
      // dostane skořápku SPA) než trvale zveřejněný web bez navigace.
      throw new Error(
        `stránka ${slug} odkazuje na útržky, které neexistují: ${missing.join(", ")} ` +
          `— zkontroluj page_settings.role='partial' a status='published'`,
      );
    }
    stranky.push({ slug, p, html });
  }

  // ⛔ KLÍČE Z CELÉHO HTML, ne jen z titulku. Stránka nese desítky
  // `data-i18n-key` uvnitř obsahu (naměřeno: index 33, features 37) — bez nich
  // by statická stránka měla přeložený jen titulek a zbytek v jazyce, který
  // autor napsal do plátna. SPA by to po převzetí opravila, tedy viditelný
  // přeskok obsahu. Přesně ta vada, kvůli které vznikl sdílený balíček.
  const klice = [
    ...new Set([
      ...stranky.flatMap(({ p }) => [p.title_key, p.description_key]),
      ...stranky.flatMap(({ html }) => extractI18nKeysFromDocument(parseHtml(html))),
    ].filter((k): k is string => !!k)),
  ];
  const preklady = await nactiPreklady(cfg, klice, branding.lang);

  let vyrobeno = 0;
  let obrazku = 0;
  let preskoceno = 0;
  for (const { slug, p, html: rozbalene } of stranky) {
    // ⛔ TITULEK BEZ PŘEKLADU = STRÁNKA SE NEVYDÁ. Dřívější `?? p.title_key`
    // poslal na produkci `<title>web.about.title</title>` a týž klíč do og:*
    // (naměřeno 2026-09-03). Surový klíč v titulku není „horší stránka", je to
    // rozbitá stránka pro vyhledávače, náhledy odkazů i čtečky — a nikdo se
    // to nedozví, protože SPA titulek po hydrataci opraví. Radši stránku
    // vynechat a nahlas říct, který klíč chybí; předchozí statická verze
    // (je-li) zůstane na disku.
    const chybi = chybejiciKlice(preklady, [p.title_key, p.description_key]);
    if (chybi.length > 0) {
      log.error({ slug, chybi }, "stránka se nevydá — titulek/popis bez překladu");
      preskoceno += 1;
      continue;
    }

    // Pořadí je nosné: nejdřív překlad (potřebuje původní `data-i18n-key`),
    // pak sanitizace (tytéž volby jako prohlížeč), teprve pak extrakce
    // obrázků — ta jen přepisuje `src`, takže na pořadí nezáleží, ale po
    // sanitizaci je jistota, že se nesahá do něčeho, co by stejně vypadlo.
    const prelozene = resolveI18nInHtml(rozbalene, preklady, parseHtml, sanitize);
    const bezpecne = sanitizeCanvasHtml(prelozene, sanitize);
    const { html: canvasHtml, pocetObrazku } = await vytahniObrazky(
      bezpecne,
      join(cfg.outDir, "_img"),
      VEREJNA_CESTA_OBRAZKU,
    );
    obrazku += pocetObrazku;

    await zapisStranku(
      cfg.outDir,
      slug,
      slozStranku({
        stranka: {
          slug,
          title: preklady[p.title_key ?? ""] ?? "",
          description: preklady[p.description_key ?? ""] ?? "",
          canvasHtml,
          canvasCss: p.canvas_css ?? "",
          ogImage: p.og_image_url ?? "",
        },
        branding,
        skorapka,
        kanonickaUrl: `https://${cfg.hostname}${slug === "index" ? "/" : `/${slug}/`}`,
      }),
    );
    vyrobeno += 1;
  }

  // Odpublikovaná stránka by jinak visela na webu dál jako statický soubor.
  const smazano = jenSlug ? 0 : await uklidOsirele(cfg.outDir, slugy);
  log.info({ vyrobeno, preskoceno, obrazku, smazano, razitko, trvaniMs: Date.now() - zacatek }, "vygenerováno");
  return { vyrobeno, razitko };
}

export async function start(): Promise<void> {
  const cfg = loadConfig();
  // ⛔ `logger: <pino instance>` Fastify 5 ODMÍTNE
  // (FST_ERR_LOG_INVALID_LOGGER_CONFIG) a služba vůbec nenastartuje —
  // naměřeno SPUŠTĚNÍM, tsc to nezachytí. `loggerInstance` sice projde, ale
  // změní typ FastifyInstance a rozbije applySecurity. Domácí tvar (a jediný,
  // co funguje s oběma) jsou VOLBY, ne instance — viz svc-source-broker.
  const app = Fastify({
    logger: { level: cfg.logLevel },
    bodyLimit: 1_048_576,
    trustProxy: true,
  });

  await applySecurity(app, {
    service: SLUZBA,
    cors: { allowlist: cfg.corsAllowlist },
    rateLimit: { enabled: cfg.rateLimitEnabled, max: 60, timeWindow: 60_000 },
  });

  // Start = vždy plné vygenerování, aby nasazení nikdy neservírovalo obsah
  // z předchozí verze. Selhání je fatální: prázdný výstupní adresář by
  // znamenal tichý pád zpět na prázdnou skořápku.
  let posledniRazitko = (await vygeneruj(cfg)).razitko;

  app.get("/healthz", async () => ({ status: "ok", service: SLUZBA, razitko: posledniRazitko }));

  // ⛔ PŘEGENEROVÁNÍ NENÍ VEŘEJNÁ OPERACE. Bez ověření by kdokoli mohl
  // opakovaným voláním nutit službu tahat všechny stránky z databáze —
  // tedy DoS páka, ne jen zbytečná práce. Volající je gateway/cron se
  // sdíleným service tokenem, týž vzor jako u sourozeneckých služeb.
  app.post<{ Querystring: { slug?: string } }>(
    "/render",
    { preHandler: requireService(cfg.serviceToken) },
    async (request, reply) => {
      const slug = request.query.slug;
      const r = await vygeneruj(cfg, slug ? { jenSlug: slug } : {});
      if (!slug) posledniRazitko = r.razitko;
      return reply.send({ ok: true, vyrobeno: r.vyrobeno });
    },
  );

  // ⛔ ČERSTVOST MÁ DVA ZDROJE, NE JEDEN (naměřeno 2026-09-01 na produkci).
  //
  // Kontrolovalo se jen razítko OBSAHU (`updated_at` stránek). Jenže statická
  // stránka do sebe zapéká i hashované názvy skriptů a stylů ze SKOŘÁPKY —
  // a ty se mění při každém buildu frontendu, aniž by se dotkly obsahu.
  //
  // Následek: po každém nasazení frontendu odkazovaly hotové stránky na
  // soubory, které už neexistují. Změřeno:
  //     shared-C7nckgUc.css → 200   (CSS se nezměnilo)
  //     shared-CUcaMi1A.js  → 404   ← statické stránky na něj odkazovaly
  //     aktuální skořápka má shared-hOtIL3J1.js
  // Návštěvník dostal obsah, ale SPA se nenačetla: `data-i18n-key` se
  // nepřeložily, přepínač jazyků nefungoval a stránka zůstala neinteraktivní.
  // Opravilo by se to samo až ve chvíli, kdy někdo upraví OBSAH — tedy nikdy.
  //
  // Otisk skořápky je proto rovnocenný spouštěč. Levný: čte jeden soubor,
  // který je k dispozici lokálně (bind mount z téhož buildu).
  const otiskSkorapky = async (): Promise<string> => {
    // Táž cesta a týž důvod jako u čtení skořápky výš: pochází z nasazovací
    // konfigurace (WEB_RENDER_SHELL), ne ze vstupu, a svazek je read-only.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const text = await readFile(cfg.shellPath, "utf8");
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
  };
  let posledniOtisk = await otiskSkorapky().catch(() => "");

  setInterval(() => {
    void (async () => {
      try {
        const index = await rpc<IndexRadek[]>(cfg, "get_published_web_page_index", {
          p_hostname: cfg.hostname,
        });
        const razitko = (index ?? []).reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
        const otisk = await otiskSkorapky();
        const zmenaObsahu = razitko !== posledniRazitko;
        const zmenaSkorapky = otisk !== posledniOtisk;
        if (zmenaObsahu || zmenaSkorapky) {
          log.info(
            { duvod: zmenaObsahu ? (zmenaSkorapky ? "obsah+skořápka" : "obsah") : "skořápka",
              otiskZ: posledniOtisk, otiskNa: otisk, z: posledniRazitko, na: razitko },
            "přegenerovávám",
          );
          posledniRazitko = (await vygeneruj(cfg)).razitko;
          posledniOtisk = otisk;
        }
      } catch (err) {
        // ⛔ `warn` schovává TRVALÉ selhání. Když se nepředgenerovává pořád
        // (třeba nedeklarovaný jazyk nebo nedostupné RPC), instance tiše
        // ztratí celý přínos předrenderu — web funguje, jen bez SEO a bez
        // prvního vykreslení, a nikdo si toho nevšimne, dokud nečte logy.
        // Na `error` se aspoň dá navěsit alerting. (Nález z cizího review.)
        log.error({ err: String(err).slice(0, 160) }, "přegenerování selhalo — statické stránky NEVZNIKLY, servíruje SPA");
      }
    })();
  }, cfg.pollMs);

  await app.listen({ host: "0.0.0.0", port: cfg.port });
  log.info({ port: cfg.port, pollMs: cfg.pollMs }, `${SLUZBA} poslouchá`);
}

start().catch((err) => {
  log.error({ err: String(err).slice(0, 300) }, `${SLUZBA} nestartuje`);
  process.exit(1);
});
