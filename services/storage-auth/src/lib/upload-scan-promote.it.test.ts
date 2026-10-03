/**
 * scanAndPromote INTEGRATION test — REAL MinIO + REAL clamd. Exercises the production S3 ops
 * (../minio.ts → the minio client) and the real INSTREAM scanner THROUGH the orchestration, asserting
 * the full fail-closed promote/block/cleanup against live backends. recordVerdict is captured
 * (the DB verdict leg is covered by src/tests/db/document-av-scan-rpc-runtime.test.ts against a
 * real Postgres in coldstart-db-gate).
 *
 * Run only by scripts/test/run-av-integration.mjs (AV_IT=1 + MINIO and CLAMD env); self-skips otherwise.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createMinioClient, getObjectStream, copyObject, deleteObject } from '../minio.js';
import { scanStream, type AvVerdict } from './av-scan.js';
import { scanAndPromote, type ScanPromoteDeps } from './upload-scan-promote.js';

const AV_IT = process.env.AV_IT === '1';
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'].join('');

const QUARANTINE = 'uploads-quarantine';
const DURABLE = 'health-documents';

describe.skipIf(!AV_IT)('scanAndPromote against REAL MinIO + clamd', () => {
  // Reuse the production client construction (createMinioClient reads the same MINIO_* config).
  const mc = createMinioClient();

  const recorded: Array<{ documentId: string; verdict: AvVerdict; durableKey: string | null }> = [];
  // Real S3 ops + real clamd scanner; verdict capture stands in for the PostgREST RPC (tested
  // against a real Postgres elsewhere). This is the production composition root, minus the DB.
  const deps: ScanPromoteDeps = {
    getObjectStream,
    copyObject,
    deleteObject,
    scan: (stream) => scanStream(stream, { timeoutMs: 60_000 }),
    recordVerdict: async (documentId, verdict, durableKey) => {
      recorded.push({ documentId, verdict, durableKey });
    },
  };

  async function ensureBucket(name: string): Promise<void> {
    if (!(await mc.bucketExists(name))) {
      await mc.makeBucket(name, process.env.MINIO_REGION ?? 'us-east-1');
    }
  }
  async function exists(bucket: string, key: string): Promise<boolean> {
    try {
      await mc.statObject(bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  beforeAll(async () => {
    await ensureBucket(QUARANTINE);
    await ensureBucket(DURABLE);
  });

  it('clean object → promoted to durable, quarantine purged, records clean + durableKey', async () => {
    const key = `${DURABLE}/user-it/${Date.now()}_clean.txt`;
    await mc.putObject(QUARANTINE, key, Buffer.from('clean integration payload\n'));
    recorded.length = 0;

    const out = await scanAndPromote(QUARANTINE, key, 'doc-it-clean', deps);
    const durableKey = key.slice(DURABLE.length + 1);

    expect(out.verdict.status).toBe('clean');
    expect(out.promoted).toBe(true);
    expect(await exists(DURABLE, durableKey)).toBe(true); // promoted to durable
    expect(await exists(QUARANTINE, key)).toBe(false); // quarantine copy dropped
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ documentId: 'doc-it-clean', durableKey });
  });

  it('EICAR object → infected, NOT promoted, malware purged from quarantine', async () => {
    const key = `${DURABLE}/user-it/${Date.now()}_eicar.txt`;
    await mc.putObject(QUARANTINE, key, Buffer.from(EICAR, 'ascii'));
    recorded.length = 0;

    const out = await scanAndPromote(QUARANTINE, key, 'doc-it-eicar', deps);
    const durableKey = key.slice(DURABLE.length + 1);

    expect(out.verdict.status).toBe('infected');
    expect(out.promoted).toBe(false);
    expect(await exists(DURABLE, durableKey)).toBe(false); // never promoted
    expect(await exists(QUARANTINE, key)).toBe(false); // malware purged
    expect(recorded[0]).toMatchObject({ documentId: 'doc-it-eicar', durableKey: null });
    expect(recorded[0].verdict.status).toBe('infected');
  });
});
