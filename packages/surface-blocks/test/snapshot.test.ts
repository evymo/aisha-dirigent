import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  generateEd25519KeyPairJwk,
  signSnapshot,
  verifySnapshot,
  type SnapshotEnvelope
} from '../src/index.js';
import { makeKpi } from './fixtures.js';

function makeEnvelope(over: Partial<SnapshotEnvelope> = {}): SnapshotEnvelope {
  return {
    schema_version: 1,
    snapshot_slug: 'daily_mobile',
    surface: 'mobile',
    published_at: '2026-07-08T06:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    max_sensitivity: 'restricted',
    blocks: [makeKpi()],
    ...over
  };
}

describe('canonical JSON', () => {
  it('is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('snapshot sign/verify (Ed25519)', () => {
  it('roundtrips: sign → verify ok', async () => {
    const { publicJwk, privateJwk } = await generateEd25519KeyPairJwk();
    const signed = await signSnapshot(makeEnvelope(), privateJwk, 'k1');
    const res = await verifySnapshot(signed, publicJwk);
    expect(res).toEqual({ ok: true });
  });

  it('signs a snapshot for a section the bundle never heard of (sections are data)', async () => {
    // The closed surface enum meant a 'porada' snapshot could not even be
    // SIGNED — the schema rejected it before any key was touched. The security
    // boundary of a snapshot is max_sensitivity, never the section name.
    const { publicJwk, privateJwk } = await generateEd25519KeyPairJwk();
    const signed = await signSnapshot(
      makeEnvelope({ snapshot_slug: 'daily_porada', surface: 'porada' }),
      privateJwk,
      'k1'
    );
    expect(await verifySnapshot(signed, publicJwk)).toEqual({ ok: true });
  });

  it('detects payload tampering', async () => {
    const { publicJwk, privateJwk } = await generateEd25519KeyPairJwk();
    const signed = await signSnapshot(makeEnvelope(), privateJwk, 'k1');
    const tampered = structuredClone(signed);
    (tampered.blocks[0] as { data: { value: number } }).data.value = 999;
    const res = await verifySnapshot(tampered, publicJwk);
    expect(res.ok).toBe(false);
  });

  it('rejects a signature from a different key', async () => {
    const a = await generateEd25519KeyPairJwk();
    const b = await generateEd25519KeyPairJwk();
    const signed = await signSnapshot(makeEnvelope(), a.privateJwk, 'k1');
    expect((await verifySnapshot(signed, b.publicJwk)).ok).toBe(false);
  });

  it('rejects an expired snapshot', async () => {
    const { publicJwk, privateJwk } = await generateEd25519KeyPairJwk();
    const signed = await signSnapshot(makeEnvelope({ expires_at: '2026-07-08T06:05:00Z' }), privateJwk, 'k1');
    const res = await verifySnapshot(signed, publicJwk, new Date('2026-07-09T00:00:00Z'));
    expect(res.reason).toMatch(/expired/);
  });

  it('ABORTS emission when any block is confidential (no silent stripping)', async () => {
    const { privateJwk } = await generateEd25519KeyPairJwk();
    const env = makeEnvelope({ blocks: [makeKpi({ sensitivity: 'confidential' })] });
    await expect(signSnapshot(env, privateJwk, 'k1')).rejects.toThrow(/ABORT|exceeds/);
  });

  it('never signs a snapshot whose cap exceeds the offline cap', async () => {
    const { privateJwk } = await generateEd25519KeyPairJwk();
    const env = makeEnvelope({ max_sensitivity: 'confidential' });
    await expect(signSnapshot(env, privateJwk, 'k1')).rejects.toThrow();
  });
});
