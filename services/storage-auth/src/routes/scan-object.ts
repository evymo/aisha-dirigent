import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { verifyServiceRole, AuthError } from '../auth.js';
import { getObjectStream, copyObject, deleteObject } from '../minio.js';
import {
  scanAndPromote,
  defaultScan,
  postRecordDocumentAvScan,
  type ScanPromoteDeps,
} from '../lib/upload-scan-promote.js';
import { config } from '../config.js';

interface ScanObjectBody {
  /**
   * Quarantine bucket the object landed in. Optional — defaults to the shared
   * uploads quarantine bucket (the only bucket presigned PUTs target).
   */
  bucket?: string;
  /**
   * Quarantine key of the freshly-landed object, encoding its intended durable
   * bucket as the first segment: `<durableBucket>/<userId>/<uuid>_<name>`.
   */
  objectKey: string;
  /**
   * member_health_documents row to stamp with the verdict. Null/omitted for
   * bucket-only uploads with no DB row (still scanned + promoted/blocked).
   */
  documentId?: string | null;
}

/**
 * Composition root for the scan→promote orchestration: the real MinIO service-role
 * S3 ops + the real clamd scanner + the service-role verdict RPC. Injected into the
 * dependency-inverted `scanAndPromote` so the route owns the concrete collaborators
 * while the orchestration stays storage-client-agnostic.
 */
const scanPromoteDeps: ScanPromoteDeps = {
  getObjectStream,
  copyObject,
  deleteObject,
  scan: defaultScan,
  recordVerdict: postRecordDocumentAvScan,
};

/**
 * POST /internal/scan-object
 *
 * The PRODUCTION caller of `scanAndPromote`. When an object lands in the uploads
 * quarantine bucket, an internal emitter (the event-worker's `storage_events`
 * consumer, or a MinIO bucket-notification webhook) POSTs the object here and this
 * route streams it to clamd and promotes/blocks it FAIL-CLOSED.
 *
 * Internal-only: the caller must present the service-role token (see
 * verifyServiceRole). This route is never exposed to end users — it performs
 * privileged service-role S3 ops and writes AV verdicts.
 */
export const scanObjectRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Body: ScanObjectBody }>('/internal/scan-object', async (req, reply) => {
    // Internal-only guard: the MinIO event webhook / event-worker must present the
    // service-role token. No end-user JWT is accepted here.
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }

    const { bucket, objectKey, documentId } = req.body ?? ({} as ScanObjectBody);
    if (typeof objectKey !== 'string' || objectKey.length === 0) {
      return reply.status(400).send({ error: 'invalid_request', message: 'objectKey is required' });
    }

    const quarantineBucket = bucket ?? config.uploadsQuarantineBucket;

    try {
      const outcome = await scanAndPromote(
        quarantineBucket,
        objectKey,
        documentId ?? null,
        scanPromoteDeps,
      );
      req.log.info(
        { quarantineBucket, objectKey, verdict: outcome.verdict.status, promoted: outcome.promoted },
        'AV scan→promote completed',
      );
      return reply.send(outcome);
    } catch (err) {
      // Malformed quarantine key or an unexpected failure — fail-closed: the object
      // stays quarantined (never served) and the caller may retry.
      req.log.error({ err, quarantineBucket, objectKey }, 'scanAndPromote failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });
};
