import type { FastifyPluginAsync, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, AuthError, isAdminOrStaff } from '../auth.js';
import { deleteObject } from '../minio.js';
import { config } from '../config.js';

/**
 * DELETE /object/:bucket/:key — smazání jednoho objektu ve VEŘEJNÉM bucketu.
 *
 * ⛔ TENHLE KONTRAKT V REPU CHYBĚL, ALE KLIENT HO VOLAL (naměřeno 2026-09-21).
 *
 * `src/integrations/api/storage.ts` posílal `DELETE /storage/v1/object/{bucket}`
 * s tělem `{prefixes:[…]}` — to je kontrakt hostovaného storage API, ne náš.
 * Měřeno přes veřejnou bránu: ta cesta vracela **404**. Správce obrázků
 * v editoru stránek tedy nikdy nic nesmazal; „smazáno" se v UI nikdy neukázalo,
 * protože `usePageAssetUpload.deleteAsset` chybu jen zaloguje.
 *
 * Proč jen veřejné buckety: privátní bucket má k objektu ŘÁDEK V DATABÁZI
 * (member_health_documents, entity evidence) a autorizaci dělá jeho RPC. Smazat
 * objekt mimo to RPC by rozešlo registr s obsahem úložiště — proto se na privátní
 * bucket odpoví stejně jako na neznámý, tedy 404, a mazání dokumentu zůstává
 * doménovou operací, ne operací úložiště.
 *
 * Role: `admin`/`staff`, stejně jako nahrávání do veřejného bucketu — kdo smí
 * obsah veřejného webu vytvořit, smí ho i odklidit; nikdo jiný ne.
 */
export const objectDeleteRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.delete('/object/:bucket/*', async (req: FastifyRequest, reply: FastifyReply) => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }

    const { bucket } = req.params as { bucket: string };
    const key = (req.params as Record<string, string>)['*'];

    if (!bucket || !key) {
      return reply.status(400).send({ error: 'invalid_path' });
    }

    if (!config.publicBuckets.has(bucket)) {
      return reply.status(404).send({ error: 'not_found' });
    }

    if (!isAdminOrStaff(user)) {
      req.log.warn({ bucket, userId: user.userId }, 'Object delete denied — needs admin/staff');
      return reply.status(403).send({
        error: 'access_denied',
        message: 'Deleting from a public bucket requires the admin or staff role',
      });
    }

    try {
      await deleteObject(bucket, key);
    } catch (err) {
      const kod = (err as { code?: string }).code;
      // Už tam není = výsledek, o který volající žádal. DELETE je idempotentní
      // (RFC 9110 §9.2.2), takže druhý pokus není chyba — ale zaznamená se,
      // protože „mažu něco, co neexistuje" bývá příznak rozejití adres.
      if (kod === 'NoSuchKey' || kod === 'NotFound') {
        req.log.info({ bucket, key }, 'Object delete — object already absent');
        return reply.status(204).send();
      }
      req.log.error({ err, bucket, key }, 'Object delete failed');
      return reply.status(502).send({ error: 'storage_unavailable' });
    }

    req.log.info({ bucket, key, userId: user.userId }, 'Object deleted');
    return reply.status(204).send();
  });
};
