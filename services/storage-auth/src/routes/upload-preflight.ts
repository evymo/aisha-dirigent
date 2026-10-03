import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { verifyToken, AuthError, isAdminOrStaff } from '../auth.js';
import { createUploadUrl } from '../upload-url.js';
import { config } from '../config.js';
import { randomUUID } from 'node:crypto';

interface UploadPreflightBody {
  /** Target bucket — present only for the generic MinIO upload flow. */
  bucket?: string;
  filename: string;
  contentType: string;
  fileSizeBytes: number;
  /** For health-documents: document category */
  category?: string;
  // ── Health-document preflight fields ──
  // The gateway rewrites `upload-health-document-preflight` → this same
  // `/upload-preflight` path (services/gateway/src/routes/functions.ts). That
  // body carries NO `bucket` and uses `mimeType`/`size` (not `contentType`/
  // `fileSizeBytes`) plus the document metadata below.
  /** Health-document MIME type. */
  mimeType?: string;
  /** Health-document file size in bytes. */
  size?: number;
  /** User-provided document title. */
  title?: string;
  /** User-provided document description. */
  description?: string;
  /** ISO date associated with the document content (YYYY-MM-DD). */
  documentDate?: string;
  /** Optional study registration this document is linked to. */
  studyRegistrationId?: string;
  // ── Entity-evidence fields (bucket `entity-evidence`) ──
  /** Which kind of thing the photo documents: 'workflow_step' | 'twin'. */
  entityKind?: string;
  /** Id of that thing (step id, twin id). */
  entityId?: string;
  /** Which declared slot this shot fills (photo_slots on the node's template). */
  slot?: string;
}

/**
 * POST /upload-preflight
 *
 * Server-mediated upload flow:
 * 1. Verify JWT
 * 2. Validate file metadata (size, MIME type)
 * 3. For private buckets: call PostgREST RPC for authorization + audit
 * 4. Generate a MinIO pre-signed upload URL INTO THE QUARANTINE BUCKET
 * 5. Return { uploadUrl, quarantineKey, objectKey, bucket, expiresIn }
 *
 * Klient pak PUTne bajty na `uploadUrl`. Přes API (`/nahrani/<token>`) proběhne sken
 * (clamd, fail-closed) a promoce do `bucket` NA KONCI TOHO PUTU a `objectKey` je rovnou
 * konečný klíč. Presigned cesta (bez STORAGE_PUBLIC_URL) jde mimo storage-auth, tam sken
 * spustí `POST /upload-complete` s `quarantineKey`. Bez skenu objekt zůstane v karanténě
 * a nikdy se neservíruje.
 */
export const uploadPreflightRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Body: UploadPreflightBody }>('/upload-preflight', async (req, reply) => {
    // 1. Auth
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }

    const { bucket, filename, contentType, fileSizeBytes, category } = req.body;

    // Health-document preflight branch: invoked via the gateway's
    // `upload-health-document-preflight` → `/upload-preflight` rewrite. That body has
    // no `bucket`; persist the member_health_documents row and return a MinIO
    // presigned PUT target (NOT a legacy hosted-storage signed-URL token — banned).
    if (!bucket) {
      return handleHealthDocumentPreflight(req, reply, user.userId, req.headers.authorization!);
    }

    // 2. Validate bucket
    if (!config.privateBuckets.has(bucket) && !config.publicBuckets.has(bucket)) {
      return reply.status(400).send({ error: 'invalid_bucket', message: `Unknown bucket: ${bucket}` });
    }

    // 3. Validate file size
    const maxBytes = config.maxFileSizeMb * 1024 * 1024;
    if (fileSizeBytes > maxBytes) {
      return reply.status(413).send({ error: 'file_too_large', message: `Max size: ${config.maxFileSizeMb} MB` });
    }

    // 4. Validate MIME type
    if (!config.allowedMimeTypes.has(contentType)) {
      return reply.status(415).send({ error: 'unsupported_type', message: `MIME type not allowed: ${contentType}` });
    }

    // 5. Sanitize filename
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const objectKey = `${user.userId}/${randomUUID()}_${sanitized}`;

    // 6. For private buckets — RLS check via PostgREST RPC.
    //
    // ⚠️ The RPC is chosen BY BUCKET (config.privateBucketRpc). Until 2026-08-05
    // this called `create_health_document_preflight_audited` unconditionally, so
    // the name of one domain's RPC stood in for "the authorization step" — fine
    // while health-documents was the only private bucket anyone wrote to, and
    // silently wrong the moment a second one exists. An unmapped bucket is
    // REFUSED, never defaulted: guessing which RPC may authorize an upload is
    // exactly the guess that must not be made.
    if (config.privateBuckets.has(bucket)) {
      const rpcName = config.privateBucketRpc.get(bucket);
      if (!rpcName) {
        req.log.error({ bucket, userId: user.userId }, 'Private bucket has no authorization RPC mapped');
        return reply.status(500).send({ error: 'internal_error' });
      }
      try {
        const rpcRes = await fetch(`${config.postgrestUrl}/rpc/${rpcName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': req.headers.authorization!,
          },
          body: JSON.stringify(
            rpcName === 'create_entity_evidence_preflight_audited'
              ? {
                  p_file_path: objectKey,
                  p_file_name: sanitized,
                  p_file_size: fileSizeBytes,
                  p_mime_type: contentType,
                  p_entity_kind: req.body.entityKind ?? null,
                  p_entity_id: req.body.entityId ?? null,
                  p_slot: req.body.slot ?? null,
                }
              : {
                  p_user_id: user.userId,
                  p_file_path: objectKey,
                  p_file_name: sanitized,
                  p_file_size: fileSizeBytes,
                  p_mime_type: contentType,
                  p_category: category ?? 'other',
                },
          ),
          signal: AbortSignal.timeout(5000),
        });

        if (!rpcRes.ok) {
          const detail = await rpcRes.text();
          req.log.warn({ status: rpcRes.status, detail, userId: user.userId }, 'Upload preflight RPC denied');
          return reply.status(403).send({ error: 'access_denied', message: 'Upload authorization failed' });
        }
      } catch (err) {
        req.log.error({ err, userId: user.userId }, 'Upload preflight RPC failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }

    // 6b. VEŘEJNÝ BUCKET POTŘEBUJE ROLI (naměřeno 2026-09-21).
    //
    // ⛔ Privátní bucket projde přes RPC (krok 6), které autorizaci i audit dělá
    // v databázi. Veřejný bucket žádné RPC nemá — a bez téhle stráže stačilo být
    // PŘIHLÁŠENÝ, aby kdokoli dostal presigned PUT do `page-assets`/`hero-images`,
    // tedy do obsahu veřejného webu. Deklarovaný požadavek „admin nebo staff" přitom
    // v repu existoval, jen v SQL politikách nad `storage.objects` — a ty jsou
    // METADATOVÉ STUBY (infra/postgres/000_init_roles_schemas.sql): soubory přes ně
    // nechodí, takže se RLS nikdy nevyhodnotí a politika je mrtvá.
    //
    // Role se čte z JWT (realm_access), stejně jako všude jinde v téhle službě.
    if (config.publicBuckets.has(bucket) && !isAdminOrStaff(user)) {
      req.log.warn({ bucket, userId: user.userId }, 'Upload preflight denied — public bucket needs admin/staff');
      return reply.status(403).send({
        error: 'access_denied',
        message: 'Uploading to a public bucket requires the admin or staff role',
      });
    }

    // 7. Kam poslat obsah — DO KARANTÉNY, a přes API, pokud instance zná veřejnou adresu
    //    storage (`createUploadUrl`, kolo 4: presigned URL MinIA nese mesh host, na který
    //    klient z terénu nedosáhne). contentType byl ověřen v kroku 4 a token ho váže.
    //
    // ⛔ DO 2026-09-21 SE PODEPISOVALO ROVNOU DO CÍLOVÉHO BUCKETU, ačkoli
    // `config.uploadsQuarantineBucket` tvrdil „landing bucket for EVERY pre-signed upload".
    // Soubor se tak dostal k uživatelům bez skenu a `scanAndPromote` v provozu nikdy neběžel
    // (naměřeno na instanci: karanténa existuje, ve VŠECH uploadových bucketech 0 objektů,
    // `clamd` běží a odpovídá PONG).
    //
    // KDO SKEN SPOUŠTÍ (dohodnuto 2026-09-23 s RIQ Driver): PUT přes API (`/nahrani/<token>`)
    // končí ve storage-authu, takže sken a promoce proběhnou NA KONCI TOHO PUTU. Klient nic
    // navíc dělat nemusí a `objectKey` v odpovědi je KONEČNÝ klíč, který smí rovnou uložit —
    // tablety řidičů (1.0.0 build 12, 1.1.0 build 14) to tak dělají a `upload-complete`
    // neznají, takže server je musí snést po celý jejich život. Jen presigned cesta (instance
    // bez STORAGE_PUBLIC_URL) jde mimo storage-auth; tam sken spustí `POST /upload-complete`.
    const quarantineKey = `${bucket}/${objectKey}`;
    const uploadUrl = await createUploadUrl(
      config.uploadsQuarantineBucket,
      quarantineKey,
      contentType,
      fileSizeBytes,
    );

    return reply.send({
      uploadUrl,
      // Klíč, který se ohlašuje na /upload-complete (nese cílový bucket jako 1. segment).
      quarantineKey,
      // Klíč v CÍLOVÉM bucketu, jak bude vypadat po promoci.
      objectKey,
      expiresIn: config.uploadUrlTtlSeconds,
      bucket,
      quarantineBucket: config.uploadsQuarantineBucket,
    });
  });
};

/**
 * Health-document upload preflight.
 *
 * 1. Validate the health-document body ({ filename, mimeType, size, category, title,
 *    description, documentDate, studyRegistrationId }).
 * 2. Enforce the shared size + MIME allowlists.
 * 3. Create the member_health_documents row via the SECURITY DEFINER RPC
 *    create_health_document_preflight_audited (owner-only + audited; auth.uid()
 *    derives the owner from the forwarded user JWT — the RPC is granted to
 *    `authenticated`, so we present the caller's Bearer token, NOT the service token).
 * 4. Return a MinIO presigned PUT target the client PUTs the raw file bytes to.
 *
 * Response shape (the client's upload path must PUT `file` to `uploadUrl`, NOT use the
 * legacy hosted-storage SDK which is banned):
 *   {
 *     documentId: string,   // member_health_documents.id — use for cleanup on PUT failure
 *     uploadUrl:  string,   // MinIO presigned PUT URL (send raw bytes; Content-Type = mimeType)
 *     objectKey:  string,   // storage path within the health-documents bucket
 *     bucket:     'health-documents',
 *     mimeType:   string,   // validated MIME the client should send as Content-Type
 *     expiresIn:  number,   // presigned-URL TTL in seconds
 *   }
 */
async function handleHealthDocumentPreflight(
  req: {
    body: UploadPreflightBody;
    log: { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  },
  reply: { status: (code: number) => typeof reply; send: (payload: unknown) => void },
  userId: string,
  authHeader: string,
): Promise<void> {
  const { filename, mimeType, size, category, title, description, documentDate, studyRegistrationId } = req.body;

  // 1. Validate required fields
  if (typeof filename !== 'string' || filename.length === 0) {
    return reply.status(400).send({ error: 'invalid_request', message: 'filename is required' });
  }
  if (typeof mimeType !== 'string' || mimeType.length === 0) {
    return reply.status(400).send({ error: 'invalid_request', message: 'mimeType is required' });
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return reply.status(400).send({ error: 'invalid_request', message: 'size must be a positive number' });
  }

  // 2. Validate file size
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  if (size > maxBytes) {
    return reply.status(413).send({ error: 'file_too_large', message: `Max size: ${config.maxFileSizeMb} MB` });
  }

  // 3. Validate MIME type
  if (!config.allowedMimeTypes.has(mimeType)) {
    return reply.status(415).send({ error: 'unsupported_type', message: `MIME type not allowed: ${mimeType}` });
  }

  // 4. Build owner-scoped object key (same convention as the generic flow).
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  const objectKey = `${userId}/${randomUUID()}_${sanitized}`;

  // 5. Persist the member_health_documents row (owner-only, audited). The RPC derives
  //    the owner from auth.uid(); forward the caller's JWT so it resolves.
  let documentId: string;
  try {
    const rpcRes = await fetch(`${config.postgrestUrl}/rpc/create_health_document_preflight_audited`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        p_file_name: sanitized,
        p_file_path: objectKey,
        p_file_size: size,
        p_mime_type: mimeType,
        p_category: category ?? 'other',
        p_title: title ?? null,
        p_description: description ?? null,
        p_document_date: documentDate ?? null,
        p_study_registration_id: studyRegistrationId ?? null,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!rpcRes.ok) {
      const detail = await rpcRes.text();
      req.log.warn({ status: rpcRes.status, detail, userId }, 'Health-document preflight RPC denied');
      return reply.status(403).send({ error: 'access_denied', message: 'Upload authorization failed' });
    }

    // RETURNS TABLE(id, file_path, file_name) → PostgREST serializes as a JSON array.
    const rows = (await rpcRes.json()) as Array<{ id?: string; file_path?: string; file_name?: string }>;
    const row = Array.isArray(rows) ? rows[0] : (rows as { id?: string });
    if (!row?.id) {
      req.log.error({ userId }, 'Health-document preflight RPC returned no row');
      return reply.status(500).send({ error: 'internal_error' });
    }
    documentId = row.id;
  } catch (err) {
    req.log.error({ err, userId }, 'Health-document preflight RPC failed');
    return reply.status(500).send({ error: 'internal_error' });
  }

  // 6. Kam poslat obsah — DO KARANTÉNY, stejně jako obecná větev (viz rozvahu u kroku 7).
  //    Řádek v `member_health_documents` drží CÍLOVOU cestu (`p_file_path: objectKey`),
  //    protože tam dokument po skenu skutečně bude. `documentId` jde do podepsaného
  //    tokenu, aby `/nahrani` mohl po skenu zapsat verdikt do TOHOTO řádku — klient ho
  //    podvrhnout nemůže (HMAC).
  const quarantineKey = `health-documents/${objectKey}`;
  const uploadUrl = await createUploadUrl(
    config.uploadsQuarantineBucket,
    quarantineKey,
    mimeType,
    size,
    documentId,
  );

  return reply.send({
    documentId,
    uploadUrl,
    quarantineKey,
    objectKey,
    bucket: 'health-documents',
    quarantineBucket: config.uploadsQuarantineBucket,
    mimeType,
    expiresIn: config.uploadUrlTtlSeconds,
  });
}
