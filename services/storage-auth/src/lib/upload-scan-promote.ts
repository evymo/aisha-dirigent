/**
 * upload-scan-promote.ts — the AV scan→promote orchestration for uploads.
 *
 * Every pre-signed upload lands in the quarantine bucket at key `<durableBucket>/<objectKey>`.
 * This module streams that object to clamd and, FAIL-CLOSED, decides its fate:
 *   clean    → server-side copy to its durable bucket, then drop the quarantine copy (promoted)
 *   infected → purge from quarantine (never reaches a durable bucket)
 *   error    → KEEP in quarantine (object is never served from there; awaits retry/review)
 * and, for tracked documents (a member_health_documents row), records the verdict via
 * record_document_av_scan_audited (which flips quarantine_status + stamps the durable path).
 *
 * Dependency inversion: this module depends only on the ScanPromoteDeps ABSTRACTION and never
 * imports the storage backend (../minio.js / the minio client). The composition root (the route
 * handler, or an integration test) injects the concrete S3 ops + scanner + verdict RPC. That
 * keeps the orchestration unit-testable with fakes and never drags the storage client into a
 * context that doesn't need it. `defaultScan` + `postRecordDocumentAvScan` are exported as the real
 * non-S3 collaborators for those composition roots to reuse.
 */
import type { Readable } from 'node:stream';
import { config } from '../config.js';
import { scanStream, type AvVerdict } from './av-scan.js';

export interface PromoteOutcome {
  verdict: AvVerdict;
  /** True only when a clean object was successfully copied to its durable bucket. */
  promoted: boolean;
  durableBucket: string;
  durableKey: string;
}

export interface ScanPromoteDeps {
  getObjectStream: (bucket: string, key: string) => Promise<Readable>;
  copyObject: (srcBucket: string, srcKey: string, dstBucket: string, dstKey: string) => Promise<void>;
  deleteObject: (bucket: string, key: string) => Promise<void>;
  scan: (stream: Readable) => Promise<AvVerdict>;
  recordVerdict: (documentId: string, verdict: AvVerdict, durableKey: string | null) => Promise<void>;
}

/** Post a verdict to the service-role RPC — the real recordVerdict for composition roots. */
export async function postRecordDocumentAvScan(
  documentId: string,
  verdict: AvVerdict,
  durableKey: string | null,
): Promise<void> {
  const signature =
    verdict.status === 'infected'
      ? verdict.signature
      : verdict.status === 'error'
        ? verdict.reason.slice(0, 200)
        : null;

  const res = await fetch(`${config.postgrestUrl}/rpc/record_document_av_scan_audited`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.postgrestServiceToken}`,
    },
    body: JSON.stringify({
      p_document_id: documentId,
      p_verdict: verdict.status,
      p_engine: 'clamav',
      p_signature: signature,
      p_durable_path: durableKey,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`record_document_av_scan_audited failed: ${res.status} ${detail}`);
  }
}

/** The real clamd scanner (no storage-client dependency) — for composition roots to reuse. */
export const defaultScan = (stream: Readable): Promise<AvVerdict> => scanStream(stream);

/** Split a quarantine key `<durableBucket>/<durableKey...>` into its two parts. */
export function splitQuarantineKey(quarantineKey: string): { durableBucket: string; durableKey: string } {
  const slash = quarantineKey.indexOf('/');
  if (slash <= 0 || slash >= quarantineKey.length - 1) {
    throw new Error(`malformed quarantine key (expected <durableBucket>/<key>): ${quarantineKey}`);
  }
  return { durableBucket: quarantineKey.slice(0, slash), durableKey: quarantineKey.slice(slash + 1) };
}

/**
 * Scan a quarantined object and promote/block it (fail-closed). `documentId` is the
 * member_health_documents row to update; pass null for bucket-only uploads with no DB row
 * (the object is still scanned + promoted/blocked, just not recorded).
 */
export async function scanAndPromote(
  quarantineBucket: string,
  quarantineKey: string,
  documentId: string | null,
  deps: ScanPromoteDeps,
): Promise<PromoteOutcome> {
  const { durableBucket, durableKey } = splitQuarantineKey(quarantineKey);

  // Scan. Any fetch/scan failure is fail-closed → 'error' (never throws out of here).
  let verdict: AvVerdict;
  try {
    const stream = await deps.getObjectStream(quarantineBucket, quarantineKey);
    verdict = await deps.scan(stream);
  } catch (err) {
    verdict = { status: 'error', reason: `fetch/scan failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  let promoted = false;
  if (verdict.status === 'clean') {
    // Promote: copy to durable. If the copy fails, DO NOT promote — downgrade to fail-closed
    // error so the object stays quarantined (never served) and can be retried.
    try {
      await deps.copyObject(quarantineBucket, quarantineKey, durableBucket, durableKey);
      promoted = true;
    } catch (err) {
      verdict = { status: 'error', reason: `promote copy failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Quarantine cleanup: drop on success (redundant copy) or on infected (purge malware).
  // On error KEEP the object — quarantine is never served, so fail-closed still holds.
  if (promoted || verdict.status === 'infected') {
    await deps.deleteObject(quarantineBucket, quarantineKey).catch(() => {
      /* best-effort: an orphaned quarantine object is never served */
    });
  }

  // Record the DB verdict for tracked documents only.
  if (documentId) {
    await deps.recordVerdict(documentId, verdict, promoted ? durableKey : null);
  }

  return { verdict, promoted, durableBucket, durableKey };
}
