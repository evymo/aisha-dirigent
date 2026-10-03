import type { FastifyPluginAsync, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { statObjectOrNull, getObjectStream, getPublicUrl } from '../minio.js';
import { guardedFetch } from '../lib/guarded-fetch.js';
import {
  cestaZdroje,
  overParametry,
  type ParametryZpracovani,
  podepsanaAdresa,
  sestavZpracovani,
  vystupniFormat,
  vyzadujePrevod,
  VYCHOZI_ROZMER_PREVODU,
} from '../lib/imgproxy-podpis.js';

/** Klíč razí preflight (uuid/uuid_sanitizované jméno); cokoli jiného do cesty imgproxy nepatří. */
const BEZPECNY_KLIC = /^[A-Za-z0-9._/-]+$/;

/**
 * GET /object/public/:bucket/:key
 *
 * Public bucket proxy — serves files from public buckets.
 * No auth required (public bucket policy).
 *
 * Matches Supabase Storage URL pattern:
 *   /storage/v1/object/public/{bucket}/{key}
 * Gateway strips /storage/v1 prefix, so this sees:
 *   /object/public/{bucket}/{key}
 *
 * Volitelné parametry `?w=&h=&fx=&fy=&z=` (bílá listina v lib/imgproxy-podpis.ts)
 * doručí VÝŘEZ přes podepsaný imgproxy: cílový rozměr, ohnisko 0..1 a přiblížení
 * 1..4. Obrázek v úložišti se nemění; každý blok si výřez spočítá při doručení.
 * HEIC/HEIF jde přes imgproxy vždy (prohlížeč ho neumí), bez parametrů jako
 * `fit` do 2000 px. Bez parametrů a bez převodu se objekt streamuje beze změny.
 */
export const publicProxyRoute: FastifyPluginAsync = async (app: FastifyInstance) => {

  app.get('/object/public/:bucket/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { bucket } = req.params as { bucket: string };
    const key = (req.params as Record<string, string>)['*'];

    if (!bucket || !key) {
      return reply.status(400).send({ error: 'invalid_path' });
    }

    // Only serve from public buckets
    if (!config.publicBuckets.has(bucket)) {
      return reply.status(404).send({ error: 'not_found' });
    }

    const parametry = overParametry((req.query ?? {}) as Record<string, unknown>);
    if (!parametry.ok) {
      return reply.status(400).send({ error: 'invalid_transform', message: parametry.chyba });
    }

    // ⛔ ODPOVĚĎ SE STREAMUJE, NEPŘESMĚROVÁVÁ (naměřeno 2026-09-21 na živé instanci).
    //
    // Dřív tu bylo `reply.redirect(getPublicUrl(...))`. Jenže ta URL míří na
    // `imgproxy`/`minio`, a obojí je v katalogu deklarované jako VNITŘNÍ adresa
    // (`internal_endpoints`, config/services.json) bez veřejné routy. Měřeno přes
    // veřejnou bránu: `GET /storage/v1/object/public/page-assets/<klíč>` vrátilo
    // `302 → http://<prefix>-imgproxy.mesh.<instance>.internal:8080/...`, tedy adresu,
    // na kterou se prohlížeč nikdy nedostane. Veřejné čtení tím bylo rozbité pro
    // KAŽDOU instanci, ne jen pro tu naši — a nikdo to nezměřil, protože do
    // veřejného bucketu se stejně nedalo nic nahrát (upload volal endpoint, který
    // neexistoval).
    //
    // Proxy tedy obsah vydá sama: jeden hop, žádná vnitřní adresa v prohlížeči.
    // `getPublicUrl` zůstává pro `/object/sign` a pro konzumenty VNITŘNÍ sítě
    // (svc-web-render), kde je vnitřní adresa správná.
    // `statObjectOrNull` (z úložiště přes API, kolo 4) vrací null pro chybějící objekt
    // i bucket — 404 tak nevzniká z textu výjimky, ale z odpovědi.
    try {
      const stat = await statObjectOrNull(bucket, key);
      if (!stat) {
        return reply.status(404).send({ error: 'not_found' });
      }

      if (parametry.hodnoty || vyzadujePrevod(key)) {
        return dorucPresImgproxy(req, reply, bucket, key, parametry.hodnoty);
      }

      const stream = await getObjectStream(bucket, key);
      reply.header('Content-Type', stat.metaData?.['content-type'] ?? 'application/octet-stream');
      if (stat.size) reply.header('Content-Length', String(stat.size));
      reply.header('Last-Modified', stat.lastModified.toUTCString());
      // Veřejný obsah se smí cachovat; klíč nese uuid, takže se nemění pod rukama.
      reply.header('Cache-Control', 'public, max-age=86400, immutable');
      return reply.send(stream);
    } catch (err) {
      req.log.error({ err, bucket, key }, 'public object stream failed');
      return reply.status(502).send({ error: 'storage_unavailable' });
    }
  });

  /**
   * GET /object/sign/:bucket/:key
   *
   * Generate a short-lived signed URL for any bucket.
   * Requires auth. For private buckets, delegates to /download route.
   * For public buckets, returns a direct URL (no signing needed).
   */
  app.get('/object/sign/:bucket/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { bucket } = req.params as { bucket: string };
    const key = (req.params as Record<string, string>)['*'];

    if (config.publicBuckets.has(bucket)) {
      return reply.send({ signedUrl: getPublicUrl(bucket, key) });
    }

    // For private buckets, redirect to POST /download endpoint
    return reply.status(400).send({
      error: 'use_download_endpoint',
      message: 'Private bucket files require POST /download with documentId',
    });
  });
};

/**
 * Výřez/převod přes PODEPSANÝ imgproxy: cesta se složí z bílé listiny, podepíše
 * klíčem instance a odpověď se streamuje dál — v prohlížeči zůstává naše adresa.
 * Bez klíče se nic „nedosadí": 501, protože nepodepsanou cestu imgproxy odmítne
 * a tichý raw stream by u HEIC dal prohlížeči obrázek, který neumí otevřít.
 */
async function dorucPresImgproxy(
  req: FastifyRequest,
  reply: FastifyReply,
  bucket: string,
  key: string,
  hodnoty: ParametryZpracovani | null,
): Promise<FastifyReply> {
  if (!config.imgproxyKey || !config.imgproxySalt) {
    return reply.status(501).send({ error: 'not_configured', message: 'image transforms need IMGPROXY_KEY and IMGPROXY_SALT' });
  }
  if (!BEZPECNY_KLIC.test(key)) {
    return reply.status(400).send({ error: 'invalid_path' });
  }

  const format = vystupniFormat(req.headers.accept, key);
  const zpracovani = hodnoty
    ? sestavZpracovani(hodnoty, 'fill')
    : sestavZpracovani({ w: VYCHOZI_ROZMER_PREVODU, h: VYCHOZI_ROZMER_PREVODU, fx: 0.5, fy: 0.5, zoom: 1 }, 'fit');
  const cesta = zpracovani + cestaZdroje(bucket, key, format);
  const adresa = podepsanaAdresa(config.imgproxyUrl, cesta, config.imgproxyKey, config.imgproxySalt);

  const res = await guardedFetch(adresa, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok || !res.body) {
    req.log.error({ bucket, key, status: res.status }, 'imgproxy transform failed');
    return reply.status(502).send({ error: 'image_processing_failed' });
  }
  reply.header('Content-Type', res.headers.get('content-type') ?? `image/${format === 'jpg' ? 'jpeg' : format}`);
  // Parametry výřezu jsou v adrese a klíč nese uuid → výsledek je neměnný; formát
  // závisí na Accept (webp), a to musí cache vědět.
  reply.header('Cache-Control', 'public, max-age=86400, immutable');
  reply.header('Vary', 'Accept');
  return reply.send(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream));
}
