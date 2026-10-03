import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { verifyToken, AuthError } from '../auth.js';
import { createSignedDownloadUrl } from '../minio.js';
import { config } from '../config.js';

interface DownloadBody {
  /** Document ID (UUID) — for private buckets (health-documents) */
  documentId?: string;
  /** Direct path — for wearable-analysis bucket */
  bucket?: string;
  objectKey?: string;
}

/**
 * POST /download
 *
 * Server-mediated download flow:
 * 1. Verify JWT
 * 2. Call PostgREST SECURITY DEFINER RPC for authorization check
 *    (owner → admin/staff → partner with consent chain)
 * 3. Generate short-lived MinIO pre-signed download URL (5 min)
 * 4. Return { downloadUrl, expiresIn }
 *
 * Anti-enumeration: returns 404 (not 403) for unauthorized access.
 */
export const downloadRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Body: DownloadBody }>('/download', async (req, reply) => {
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

    const { documentId, bucket, objectKey } = req.body;

    // Route A: health-documents via document ID (uses full authorization chain)
    if (documentId) {
      return handleHealthDocumentDownload(req, reply, user.userId, documentId, req.headers.authorization!);
    }

    // Route B: direct bucket/key for wearable-analysis (owner-only)
    if (bucket && objectKey) {
      if (!config.privateBuckets.has(bucket)) {
        return reply.status(400).send({ error: 'invalid_bucket' });
      }

      // Owner check: object key must start with user's ID
      if (!objectKey.startsWith(`${user.userId}/`)) {
        // Anti-enumeration: 404 not 403
        return reply.status(404).send({ error: 'not_found' });
      }

      const downloadUrl = await createSignedDownloadUrl(bucket, objectKey);
      return reply.send({ downloadUrl, expiresIn: config.downloadUrlTtlSeconds });
    }

    return reply.status(400).send({ error: 'invalid_request', message: 'Provide documentId or bucket+objectKey' });
  });
};

/**
 * Full health-document authorization chain:
 * Calls get_health_document_download_info_audited (SECURITY DEFINER)
 * which checks: owner → admin/staff → partner (consent + sharing permission)
 * Returns file_path only if authorized, writes audit journal entry.
 */
async function handleHealthDocumentDownload(
  req: { log: { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }; headers: { authorization?: string } },
  reply: { status: (code: number) => typeof reply; send: (payload: unknown) => void },
  userId: string,
  documentId: string,
  authHeader: string,
): Promise<void> {
  try {
    const rpcRes = await fetch(
      `${config.postgrestUrl}/rpc/get_health_document_download_info_audited`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({ p_document_id: documentId }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!rpcRes.ok) {
      const detail = await rpcRes.text();
      req.log.warn({ status: rpcRes.status, detail, userId, documentId }, 'Download auth denied');
      // Anti-enumeration: 404 not 403
      return reply.status(404).send({ error: 'not_found' });
    }

    // get_health_document_download_info_audited RETURNS TABLE(id, file_path, user_id),
    // so PostgREST serializes it as a JSON array — parse the first row (empty array =
    // unauthorized/not-found → 404, matching the anti-enumeration contract).
    const rows = await rpcRes.json() as Array<{ file_path?: string }>;
    const filePath = (Array.isArray(rows) ? rows[0]?.file_path : (rows as { file_path?: string })?.file_path);

    if (!filePath) {
      return reply.status(404).send({ error: 'not_found' });
    }

    const downloadUrl = await createSignedDownloadUrl('health-documents', filePath);

    // `signedUrl` / `expiresInSeconds` are the field names the web client's
    // downloadSchema validates against (src/hooks/useTrackingDocuments.ts,
    // getDocumentUrl). `downloadUrl` / `expiresIn` are kept for back-compat.
    return reply.send({
      downloadUrl,
      signedUrl: downloadUrl,
      expiresIn: config.downloadUrlTtlSeconds,
      expiresInSeconds: config.downloadUrlTtlSeconds,
    });
  } catch (err) {
    req.log.error({ err, userId, documentId }, 'Download RPC failed');
    return reply.status(500).send({ error: 'internal_error' });
  }
}
