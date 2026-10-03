import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { verifyToken, AuthError, isAdminOrStaff } from '../auth.js';
import { statObjectOrNull } from '../minio.js';
import { splitQuarantineKey } from '../lib/upload-scan-promote.js';
import { promujZKaranteny } from '../lib/promoce.js';
import { zapisMedium } from '../lib/media-zaznam.js';
import { config } from '../config.js';
import { guardedFetch } from '../lib/guarded-fetch.js';

/**
 * POST /upload-complete — klient ohlásí, že PUT dobehl; TEĎ se objekt oskenuje a promuje.
 *
 * ⛔ TOHLE JE CHYBĚJÍCÍ SPOUŠTĚČ ANTIVIRU (naměřeno 2026-09-21 na živé instanci).
 *
 * Deklarace v `config.ts` tvrdila: „Landing bucket for every pre-signed upload …
 * the intended durable bucket is encoded as the first key segment". Skutečnost byla jiná
 * a ve TŘECH nezávislých místech:
 *   1. preflight podepisoval PUT přímo do CÍLOVÉHO bucketu, karanténa se nepoužila vůbec;
 *   2. `storage_events` NIKDO nevyráběl — `uploads-quarantine` na instanci existuje, ale
 *      nemá žádnou notifikační konfiguraci (žádné `mc event add` v repu ani v MinIO);
 *   3. event-worker, který `storage_events` poslouchá, NEMÁ v prostředí `STORAGE_AUTH_URL`,
 *      takže jeho přeposlání na sken (`if (channel === 'storage_events' && config.storageAuthUrl)`)
 *      by nevystřelilo ani s emitorem.
 * Přitom `clamd` BĚŽÍ a odpovídá `PONG` (měřeno TCP z netns storage-authu) a
 * `AV_SCAN_ENABLED=true`. Ve všech uploadových bucketech bylo 0 objektů.
 *
 * PROČ TOUHLE CESTOU, a ne notifikacemi z MinIO: spouštěč musí být ten, kdo VÍ, že nahrání
 * dobehlo — a to je klient, který PUT dokončil. Notifikace z MinIO by přidaly druhý kanál
 * (MinIO → tabulka → trigger → NOTIFY → worker → HTTP), tedy pět míst, kde se dá tiše
 * přerušit, a právě takhle to dopadlo. Klientské ohlášení je JEDEN hop a je synchronní,
 * což editor plátna potřebuje: po nahrání chce adresu obrázku hned, ne „za chvíli".
 *
 * A NENÍ to důvěra v klienta: kdo neohlásí, nedostane nic — objekt zůstane v karanténě,
 * která se z ničeho neservíruje (`/object/public/*` pouští jen veřejné buckety), takže
 * mlčení je fail-closed. Autorizace se nečte z těla, ale z klíče: druhý segment karanténního
 * klíče MUSÍ být `userId` z tokenu, jinak by kdokoli nechal promovat cizí nahrávku.
 *
 * Veřejný bucket (2026-09-24): po čisté promoci se objekt zapíše do evidence médií
 * (`media_assets`) — obojí větví, i té idempotentní, protože přes API mohl záznam na
 * konci PUTu selhat a tohle ohlášení je jeho opakování. Bez záznamu končí 502: obrázek
 * bez evidence by v galerii chyběl a nikdo by se to nedozvěděl.
 */
export const uploadCompleteRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Body: { objectKey?: string; documentId?: string | null } }>(
    '/upload-complete',
    async (req, reply) => {
      let user;
      try {
        user = await verifyToken(req.headers.authorization);
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }

      const { objectKey, documentId } = req.body ?? {};
      if (typeof objectKey !== 'string' || objectKey.length === 0) {
        return reply.status(400).send({ error: 'invalid_request', message: 'objectKey is required' });
      }

      // Karanténní klíč je `<durableBucket>/<userId>/<uuid>_<jméno>`. Rozpad je
      // deklarovaný v upload-scan-promote (splitQuarantineKey) — čte se odtud, aby
      // tahle routa a promoce nemohly mít o tvaru klíče jiný názor.
      let durableBucket: string;
      let durableKey: string;
      try {
        ({ durableBucket, durableKey } = splitQuarantineKey(objectKey));
      } catch {
        return reply.status(400).send({ error: 'invalid_request', message: 'malformed objectKey' });
      }

      if (!config.publicBuckets.has(durableBucket) && !config.privateBuckets.has(durableBucket)) {
        return reply.status(400).send({ error: 'invalid_bucket', message: `Unknown bucket: ${durableBucket}` });
      }

      // VLASTNICTVÍ z klíče, ne z těla: klíč razí preflight jako `<userId>/…`, takže
      // cizí nahrávku nelze nechat promovat ani se správným tokenem.
      if (!durableKey.startsWith(`${user.userId}/`)) {
        req.log.warn({ durableBucket, userId: user.userId }, 'Upload complete denied — key belongs to another user');
        return reply.status(403).send({ error: 'access_denied' });
      }

      // Veřejný bucket je obsah veřejného webu — stejná role jako u preflightu.
      if (config.publicBuckets.has(durableBucket) && !isAdminOrStaff(user)) {
        return reply.status(403).send({ error: 'access_denied' });
      }

      // `documentId` přichází od klienta, takže se NEVĚŘÍ: pár (id, cesta) se ověří
      // ČTENÍM POD TOKENEM UŽIVATELE. RLS pustí jen vlastníkovy řádky, takže cizí id
      // nevrátí nic a verdikt se do cizí evidence nezapíše.
      let overenyDocumentId: string | null = null;
      if (typeof documentId === 'string' && documentId.length > 0) {
        const dotaz =
          `${config.postgrestUrl}/member_health_documents` +
          `?id=eq.${encodeURIComponent(documentId)}` +
          `&file_path=eq.${encodeURIComponent(durableKey)}&select=id&limit=1`;
        try {
          const res = await guardedFetch(dotaz, {
            headers: { Authorization: req.headers.authorization! },
            signal: AbortSignal.timeout(5000),
          });
          const rows = res.ok ? ((await res.json()) as Array<{ id?: string }>) : [];
          if (!Array.isArray(rows) || rows.length === 0 || !rows[0]?.id) {
            req.log.warn({ userId: user.userId }, 'Upload complete — documentId does not match the uploaded path');
            return reply.status(403).send({ error: 'access_denied' });
          }
          overenyDocumentId = rows[0].id!;
        } catch (err) {
          req.log.error({ err, userId: user.userId }, 'Upload complete — document ownership check failed');
          return reply.status(500).send({ error: 'internal_error' });
        }
      }

      /** Evidence média pro veřejný bucket; selhání = 502 (viz hlavičku). */
      const zaevidujMedium = async (bytes: number, contentType: string): Promise<boolean> => {
        if (!config.publicBuckets.has(durableBucket)) return true;
        try {
          await zapisMedium({ bucket: durableBucket, objectKey: durableKey, contentType, bytes });
          return true;
        } catch (err) {
          req.log.error({ err, durableBucket, userId: user.userId }, 'Media record failed');
          return false;
        }
      };

      // ⛔ IDEMPOTENTNÍ (2026-09-23). Přes API (`/nahrani`) se objekt oskenuje a promuje
      // už na konci PUTu, takže v karanténě NENÍ — a webový klient volá tuhle routu vždy,
      // protože neví, kudy jeho PUT šel. Objekt, který už je v cílovém bucketu, je
      // hotový výsledek, ne chyba. Teprve když není ani tam, je to 404.
      const vKarantene = await statObjectOrNull(config.uploadsQuarantineBucket, objectKey);
      if (!vKarantene) {
        const hotovy = await statObjectOrNull(durableBucket, durableKey);
        if (hotovy) {
          if (!(await zaevidujMedium(hotovy.size, hotovy.metaData?.['content-type'] ?? 'application/octet-stream'))) {
            return reply.status(502).send({ error: 'media_record_failed' });
          }
          return reply.send({ bucket: durableBucket, objectKey: durableKey, status: 'clean' });
        }
        return reply.status(404).send({ error: 'not_found' });
      }

      const vysledek = await promujZKaranteny(objectKey, overenyDocumentId);

      if (vysledek.stav === 'infikovany') {
        req.log.warn({ durableBucket, userId: user.userId, signature: vysledek.podpis }, 'Upload rejected — infected');
        return reply.status(422).send({ error: 'infected', message: 'The uploaded file was rejected by the virus scanner' });
      }

      if (vysledek.stav === 'nedokonceno') {
        // FAIL-CLOSED: nedostupný clamd, vyčerpaný strop i selhaná kopie končí tady.
        // Objekt zůstává v karanténě (neservíruje se) a smí se zkusit znovu.
        req.log.error({ durableBucket, userId: user.userId, duvod: vysledek.duvod }, 'Upload not promoted');
        return reply.status(502).send({ error: 'scan_unavailable', message: 'The file could not be verified; try again' });
      }

      if (!(await zaevidujMedium(vKarantene.size, vKarantene.metaData?.['content-type'] ?? 'application/octet-stream'))) {
        return reply.status(502).send({ error: 'media_record_failed' });
      }

      return reply.send({ bucket: vysledek.bucket, objectKey: vysledek.klic, status: 'clean' });
    },
  );
};
