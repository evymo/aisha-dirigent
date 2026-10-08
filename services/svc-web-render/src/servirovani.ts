/**
 * Servírování předrenderovaného výstupu po HTTP — varianta (d-ii).
 *
 * ⛔ PROČ (rozhodnutí majitele 2026-10-02, rozbor 2026-09-28 „holé ${VAR} → svazek“):
 * web (Edge) a svc-web-render jsou DVĚ Coolify aplikace. Coolify 4.3.16 neumí sdílet
 * disk mezi aplikacemi — holý `${VAR}` ve zdroji svazku převede na pojmenovaný svazek
 * `<uuid>_<slug>` KAŽDÉ aplikace zvlášť, takže web četl prázdný `_static` a předrender
 * se nikdy neservíroval. Mezi aplikacemi se proto předává PO SÍTI: výstup drží
 * web-render ve vlastním svazku a vydává ho sám; Edge (nginx) si ho táhne meshem,
 * drží v krátké cache a když web-render neodpoví, padá na SPA skořápku.
 *
 * Tvar URL je TÝŽ, jaký dřív obsluhoval nginx z `_static` (docker/nginx.conf):
 *   /              → <out>/index.html
 *   /<slug>[/]     → <out>/<slug>/index.html   (i vnořený slug a/b)
 *   /_img/<soubor> → <out>/_img/<soubor>       (jméno = sha256 obsahu → neměnné)
 * Cokoli jiného je 404 — Edge pak servíruje SPA. Čtení je veřejný obsah (táž data
 * jako na veřejném webu); vstup je jen URL, proto přísná normalizace níž.
 */
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const TYPY: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/** Povolený segment cesty: písmena, číslice a `-_.~`; NE začínající tečkou (skryté soubory, `..`). */
const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;

/**
 * Jméno obrázku PŘESNĚ v tvaru, jaký vyrábí renderer: 16 hex z sha256 + známá
 * přípona. Obecný SEGMENT by pustil i rozepsaný `<hash>.png.tmp-…` z atomického
 * zápisu (nález při revizi d-ii 2026-10-02).
 */
const OBRAZEK = /^[0-9a-f]{16}\.(png|jpe?g|gif|webp|avif|svg)$/;

/** Otisk skořápky, jak ho počítá web i renderer: prvních 16 hex sha256 index.html. */
const OTISK = /^[0-9a-f]{16}$/;

/** Hlavička, kterou Edge posílá otisk SVÉ skořápky (docker/web-start.sh → nginx). */
export const HLAVICKA_OTISKU = "x-skorapka-otisk";

/**
 * URL → absolutní cesta souboru ve výstupu, nebo `null` (= 404).
 * Odmítne: neplatné kódování, NUL, `.`/`..`/skryté segmenty, znaky mimo SEGMENT,
 * `/_img` jinak než s právě jedním jménem obrázku, a cokoli, co by po rozřešení
 * vyšlo mimo kořen výstupu.
 */
export function souborProCestu(koren: string, url: string): string | null {
  let cesta: string;
  try {
    cesta = decodeURIComponent(url.split("?")[0] ?? "");
  } catch {
    return null;
  }
  if (cesta.includes("\0")) return null;
  const segmenty = cesta.split("/").filter((s) => s !== "");
  if (segmenty.some((s) => !SEGMENT.test(s))) return null;

  let relativni: string[];
  if (segmenty[0] === "_img") {
    if (segmenty.length !== 2 || !OBRAZEK.test(segmenty[1] ?? "")) return null;
    relativni = segmenty;
  } else {
    relativni = [...segmenty, "index.html"];
  }

  const korenAbs = resolve(koren);
  const soubor = resolve(korenAbs, ...relativni);
  if (!soubor.startsWith(korenAbs + sep)) return null;
  return soubor;
}

export interface VolbyServirovani {
  /** Kořen výstupu (svazek web-renderu). */
  koren: string;
  /**
   * Otisk skořápky, ze které je AKTUÁLNÍ výstup stránek ("" = nevíme / ještě
   * není). Když Edge pošle svůj otisk a ten nesedí, stránka by odkazovala na
   * chunky, které běžící web nemá — vrátí se 412 a Edge servíruje SPA.
   */
  otiskVystupu: () => string;
}

/** Slabý validátor z velikosti a času změny — zápisy jsou atomické (rename), takže se mění s obsahem. */
function etagZeStatu(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

/** Je požadavek podmíněný a odpovídá-li aktuální verzi souboru → 304. */
function nezmeneno(request: FastifyRequest, etag: string, mtimeMs: number): boolean {
  const inm = request.headers["if-none-match"];
  if (typeof inm === "string") {
    // If-None-Match má přednost před If-Modified-Since (RFC 9110 §13.2.2).
    return inm.split(",").some((t) => t.trim() === etag || t.trim() === "*");
  }
  const ims = request.headers["if-modified-since"];
  if (typeof ims === "string") {
    const kdy = Date.parse(ims);
    // HTTP datum má rozlišení na sekundy — porovnává se na celé sekundy.
    if (!Number.isNaN(kdy)) return Math.floor(mtimeMs / 1000) * 1000 <= kdy;
  }
  return false;
}

/**
 * Zaregistruje GET (a automaticky HEAD) nad výstupem. Specifické trasy (`/healthz`)
 * mají přednost. Globální limit požadavků tu NEPLATÍ: volá jen Edge (nginx) meshem,
 * a limit 60/min na klienta by veřejným návštěvníkům i crawlerům vracel 429 místo
 * stránky (nález revize d-ii 2026-10-02). Omezování patří na Edge.
 */
export function zaregistrujServirovani(app: FastifyInstance, volby: VolbyServirovani): void {
  const { koren, otiskVystupu } = volby;
  const obsluha = async (request: FastifyRequest, reply: FastifyReply) => {
    const soubor = souborProCestu(koren, request.url);
    if (!soubor) return reply.code(404).send();
    const obrazek = soubor.includes(`${sep}_img${sep}`);

    if (!obrazek) {
      const otiskEdge = request.headers[HLAVICKA_OTISKU];
      if (typeof otiskEdge === "string" && OTISK.test(otiskEdge) && otiskEdge !== otiskVystupu()) {
        // Výstup je z JINÉ skořápky, než jakou Edge právě servíruje (web se
        // přenasadil a přegenerování ještě nedoběhlo). 412 se necachuje a Edge
        // na něj servíruje SPA — návštěvník nikdy nedostane stránku se starými chunky.
        return reply.code(412).header("cache-control", "no-store").send();
      }
    }

    try {
      // Cesta je výstupem souborProCestu: normalizovaná, bez `..`, uvnitř kořene výstupu.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const st = await stat(soubor);
      if (!st.isFile()) return reply.code(404).send();
      const etag = etagZeStatu(st.size, st.mtimeMs);
      reply
        .header("etag", etag)
        .header("last-modified", new Date(st.mtimeMs).toUTCString())
        .header("x-content-type-options", "nosniff")
        // Obrázky se jmenují podle sha256 obsahu → neměnné. Stránky se mění s obsahem
        // i se skořápkou, takže se jen revalidují (podmíněný GET → 304).
        .header("cache-control", obrazek ? "public, max-age=31536000, immutable" : "no-cache");
      if (nezmeneno(request, etag, st.mtimeMs)) return reply.code(304).send();
      reply.header("content-type", TYPY[extname(soubor).toLowerCase()] ?? "application/octet-stream");
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return reply.send(await readFile(soubor));
    } catch {
      return reply.code(404).send();
    }
  };
  const bezLimitu = { config: { rateLimit: false } } as const;
  app.get("/", bezLimitu, obsluha);
  app.get("/*", bezLimitu, obsluha);
}
