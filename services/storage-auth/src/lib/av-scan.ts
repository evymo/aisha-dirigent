/**
 * av-scan.ts — storage-auth's door to the shared ClamAV INSTREAM client.
 *
 * The client itself lives in `@aisha/security/av-scan` (one implementation for every
 * file intake: uploads here, documents synced into local-ingest, knowledge-base
 * uploads). This module only supplies storage-auth's own target — the delivered
 * CLAMD_HOST/CLAMD_PORT and the per-scan budget — so callers keep saying
 * `scanStream(body)` and tests keep overriding the target per call.
 *
 * FAIL-CLOSED is unchanged: any verdict other than `clean` blocks promotion.
 */
import type { Readable } from 'node:stream';
import {
  scan as scanWith,
  isClean,
  parseClamdReply,
  type AvScanSource,
  type AvScanTarget,
  type AvVerdict,
} from '@aisha/security/av-scan';
import { config } from '../config.js';

export { isClean, parseClamdReply };
export type { AvScanSource, AvVerdict };

/** Per-call overrides of the configured clamd target. */
export type AvScanOptions = Partial<AvScanTarget>;

function cil(opts: AvScanOptions): AvScanTarget {
  return {
    host: opts.host ?? config.clamdHost,
    port: opts.port ?? config.clamdPort,
    timeoutMs: opts.timeoutMs ?? config.clamdTimeoutMs,
    chunkSize: opts.chunkSize,
  };
}

/** Scan an arbitrary source against clamd. Never throws — always resolves to a verdict. */
export function scan(source: AvScanSource, opts: AvScanOptions = {}): Promise<AvVerdict> {
  return scanWith(source, cil(opts));
}

/** Convenience: scan a fully-buffered payload. */
export function scanBuffer(data: Buffer, opts: AvScanOptions = {}): Promise<AvVerdict> {
  return scan(data, opts);
}

/** Convenience: scan a Node Readable (e.g. an S3 GetObject body) without buffering it. */
export function scanStream(stream: Readable, opts: AvScanOptions = {}): Promise<AvVerdict> {
  return scan(stream, opts);
}
