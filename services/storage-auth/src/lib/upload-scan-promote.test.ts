/**
 * scanAndPromote unit tests — drive the orchestration with injected fakes (no MinIO / clamd /
 * PostgREST). Asserts the fail-closed promote/block/cleanup matrix + verdict recording.
 */
import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { scanAndPromote, splitQuarantineKey, type ScanPromoteDeps } from './upload-scan-promote.js';
import type { AvVerdict } from './av-scan.js';

interface Calls {
  copied: Array<[string, string, string, string]>;
  deleted: Array<[string, string]>;
  recorded: Array<{ documentId: string; verdict: AvVerdict; durableKey: string | null }>;
}

function makeDeps(
  verdict: AvVerdict | (() => Promise<AvVerdict>),
  overrides: Partial<ScanPromoteDeps> = {},
): { deps: ScanPromoteDeps; calls: Calls } {
  const calls: Calls = { copied: [], deleted: [], recorded: [] };
  const deps: ScanPromoteDeps = {
    getObjectStream: async () => Readable.from([Buffer.from('payload')]),
    scan: typeof verdict === 'function' ? verdict : async () => verdict,
    copyObject: async (sb, sk, db, dk) => {
      calls.copied.push([sb, sk, db, dk]);
    },
    deleteObject: async (b, k) => {
      calls.deleted.push([b, k]);
    },
    recordVerdict: async (documentId, v, durableKey) => {
      calls.recorded.push({ documentId, verdict: v, durableKey });
    },
    ...overrides,
  };
  return { deps, calls };
}

const QBUCKET = 'uploads-quarantine';
const QKEY = 'health-documents/user-123/abc_report.pdf';
const DURABLE_BUCKET = 'health-documents';
const DURABLE_KEY = 'user-123/abc_report.pdf';

describe('splitQuarantineKey', () => {
  it('splits <durableBucket>/<key>', () => {
    expect(splitQuarantineKey(QKEY)).toEqual({ durableBucket: DURABLE_BUCKET, durableKey: DURABLE_KEY });
  });
  it('rejects a key with no durable-bucket segment', () => {
    expect(() => splitQuarantineKey('noslash')).toThrow();
    expect(() => splitQuarantineKey('/leading')).toThrow();
    expect(() => splitQuarantineKey('trailing/')).toThrow();
  });
});

describe('scanAndPromote', () => {
  it('clean → copies to durable, drops quarantine copy, records clean+durableKey, promoted', async () => {
    const { deps, calls } = makeDeps({ status: 'clean' });
    const out = await scanAndPromote(QBUCKET, QKEY, 'doc-1', deps);

    expect(out.promoted).toBe(true);
    expect(out.verdict.status).toBe('clean');
    expect(calls.copied).toEqual([[QBUCKET, QKEY, DURABLE_BUCKET, DURABLE_KEY]]);
    expect(calls.deleted).toEqual([[QBUCKET, QKEY]]); // quarantine copy removed
    expect(calls.recorded).toEqual([{ documentId: 'doc-1', verdict: { status: 'clean' }, durableKey: DURABLE_KEY }]);
  });

  it('infected → no copy, purges quarantine, records infected+null durableKey, not promoted', async () => {
    const { deps, calls } = makeDeps({ status: 'infected', signature: 'Eicar' });
    const out = await scanAndPromote(QBUCKET, QKEY, 'doc-2', deps);

    expect(out.promoted).toBe(false);
    expect(calls.copied).toEqual([]); // never promoted
    expect(calls.deleted).toEqual([[QBUCKET, QKEY]]); // malware purged
    expect(calls.recorded[0]).toMatchObject({ documentId: 'doc-2', durableKey: null });
    expect(calls.recorded[0].verdict.status).toBe('infected');
  });

  it('scan error → fail-closed: no copy, KEEPS quarantine object, records error', async () => {
    const { deps, calls } = makeDeps({ status: 'error', reason: 'clamd unreachable' });
    const out = await scanAndPromote(QBUCKET, QKEY, 'doc-3', deps);

    expect(out.promoted).toBe(false);
    expect(calls.copied).toEqual([]);
    expect(calls.deleted).toEqual([]); // KEPT for retry/review — never served from quarantine
    expect(calls.recorded[0]).toMatchObject({ documentId: 'doc-3', durableKey: null });
    expect(calls.recorded[0].verdict.status).toBe('error');
  });

  it('fetch/scan throws → fail-closed error verdict (never throws out)', async () => {
    const { deps, calls } = makeDeps(async () => {
      throw new Error('socket reset');
    });
    const out = await scanAndPromote(QBUCKET, QKEY, 'doc-4', deps);

    expect(out.verdict.status).toBe('error');
    expect(out.promoted).toBe(false);
    expect(calls.deleted).toEqual([]); // kept
    expect(calls.recorded[0].verdict.status).toBe('error');
  });

  it('clean but copy fails → downgrades to error, NOT promoted, keeps quarantine object', async () => {
    const { deps, calls } = makeDeps({ status: 'clean' }, {
      copyObject: async () => {
        throw new Error('s3 5xx');
      },
    });
    const out = await scanAndPromote(QBUCKET, QKEY, 'doc-5', deps);

    expect(out.promoted).toBe(false);
    expect(out.verdict.status).toBe('error');
    expect(calls.deleted).toEqual([]); // not deleted — stays quarantined for retry
    expect(calls.recorded[0]).toMatchObject({ documentId: 'doc-5', durableKey: null });
  });

  it('documentId=null (untracked bucket) → still promotes the object, but records nothing', async () => {
    const { deps, calls } = makeDeps({ status: 'clean' });
    const out = await scanAndPromote(QBUCKET, QKEY, null, deps);

    expect(out.promoted).toBe(true);
    expect(calls.copied).toEqual([[QBUCKET, QKEY, DURABLE_BUCKET, DURABLE_KEY]]);
    expect(calls.recorded).toEqual([]); // no DB row to update
  });
});
