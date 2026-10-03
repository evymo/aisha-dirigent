import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { putObjectStream } from '../minio.js';
import { overToken, TokenError } from '../lib/nahravaci-token.js';
import { HlidanyProud, PrilisVelke, vedTelo, zahodZbytek } from '../lib/hlidany-proud.js';
import { promujZKaranteny } from '../lib/promoce.js';
import { zapisMedium } from '../lib/media-zaznam.js';

/**
 * PUT /nahrani/<token> — obsah souboru, na který preflight vydal právo.
 *
 * Přes gateway `/storage/v1/nahrani/…`, tedy za dveřmi, které klient otevírá
 * i pro API. Tělo se NEPARSUJE ani nebufferuje: teče z požadavku přes hlídaný
 * proud rovnou do MinIA. Autorizace je token sám (bucket, klíč, typ, strop,
 * expirace pod HMAC) — stejně úzké právo, jaké nesla presigned URL.
 */
export const nahraniRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Tělo nechat v proudu; parser jen v tomhle pluginu, jinde platí výchozí.
  app.addContentTypeParser('*', (_req, _payload, done) => done(null));

  // ⛔ Wildcard, ne `:token`: parametrická cesta má ve Fastify strop
  // `maxParamLength` = 100 znaků a token je delší — každé nahrání by skončilo
  // 404 (naměřeno testem 2026-09-18, nahrani.test.ts).
  app.put<{ Params: { '*': string } }>('/nahrani/*', async (req, reply) => {
    if (!config.uploadTokenSecret) {
      return reply.status(501).send({ error: 'not_configured' });
    }
    let pravo;
    try {
      pravo = overToken(req.params['*'], config.uploadTokenSecret);
    } catch (err) {
      if (err instanceof TokenError) {
        zahodZbytek(req.raw);
        return reply.status(err.duvod === 'expirace' ? 403 : 401).send({ error: `token_${err.duvod}` });
      }
      throw err;
    }

    // Zdravotní dokument MUSÍ nést řádek, do kterého se zapíše verdikt. Token bez něj
    // vydala starší instance během nasazování — odmítnout jako neplatný tvar, klient
    // zopakuje preflight (token je krátkodobý). Pustit ho bez `d` by znamenalo sken
    // bez zápisu do evidence, tedy dokument bez stavu karantény (RIQ Driver 2026-09-23).
    const doKaranteny = pravo.b === config.uploadsQuarantineBucket;
    if (doKaranteny && pravo.k.startsWith('health-documents/') && !pravo.d) {
      zahodZbytek(req.raw);
      return reply.status(401).send({ error: 'token_tvar' });
    }

    const typ = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (typ !== pravo.t.toLowerCase()) {
      zahodZbytek(req.raw);
      return reply.status(415).send({ error: 'content_type_mismatch' });
    }
    const delka = Number(req.headers['content-length']);
    if (!Number.isInteger(delka) || delka < 0) {
      zahodZbytek(req.raw);
      return reply.status(411).send({ error: 'length_required' });
    }
    if (delka > pravo.max) {
      zahodZbytek(req.raw);
      return reply.status(413).send({ error: 'file_too_large' });
    }

    const hlidac = new HlidanyProud(delka);
    vedTelo(req.raw, hlidac);
    try {
      await putObjectStream(pravo.b, pravo.k, hlidac, delka, { 'Content-Type': pravo.t });
    } catch (err) {
      zahodZbytek(req.raw, hlidac);
      if (err instanceof PrilisVelke) return reply.status(413).send({ error: 'file_too_large' });
      req.log.error({ err, bucket: pravo.b }, 'Upload stream to storage failed');
      return reply.status(502).send({ error: 'storage_failed' });
    }
    if (!doKaranteny) {
      // Token míří rovnou do cílového bucketu: vydaný před zavedením karantény (během
      // nasazování, TTL tokenu) nebo schopnost bez skenu (APK hlídače má vlastní cestu).
      return reply.status(200).send({ ok: true, objectKey: pravo.k, bytes: hlidac.bajtu });
    }

    // ⛔ SKEN A PROMOCE NA KONCI PUTU (dohodnuto 2026-09-23 s RIQ Driver).
    //
    // Server tu VÍ, že tělo dotéklo, takže nepotřebuje ohlášení od klienta — a to je
    // nutné, protože tablety řidičů (1.0.0 build 12, 1.1.0 build 14) `upload-complete`
    // neznají, klíč z preflightu ukládají rovnou do záznamu a poběží, dokud hlídač
    // nerozdá další build. Preflight jim proto dává KONEČNÝ klíč a tady se objekt na ten
    // klíč dostane — nebo PUT skončí chybou a appka doklad neodešle (to už umí).
    const vysledek = await promujZKaranteny(pravo.k, pravo.d ?? null);
    if (vysledek.stav === 'infikovany') {
      req.log.warn({ signature: vysledek.podpis }, 'Upload rejected by virus scanner');
      return reply.status(422).send({ error: 'infected' });
    }
    if (vysledek.stav === 'nedokonceno') {
      req.log.error({ duvod: vysledek.duvod }, 'Upload not promoted — stays in quarantine');
      return reply.status(502).send({ error: 'scan_unavailable' });
    }

    // Veřejný bucket = médium webu → evidence pro galerii (2026-09-24). Selhání záznamu
    // tady PUT neshodí: objekt už je čistý a v cílovém bucketu a webový klient vzápětí
    // volá `/upload-complete`, které záznam zopakuje (idempotentní) a bez něj skončí 502.
    if (config.publicBuckets.has(vysledek.bucket)) {
      try {
        await zapisMedium({ bucket: vysledek.bucket, objectKey: vysledek.klic, contentType: pravo.t, bytes: hlidac.bajtu });
      } catch (err) {
        req.log.warn({ err, bucket: vysledek.bucket }, 'Media record failed at PUT end — upload-complete will retry');
      }
    }

    return reply.status(200).send({
      ok: true,
      bucket: vysledek.bucket,
      objectKey: vysledek.klic,
      bytes: hlidac.bajtu,
    });
  });
};
