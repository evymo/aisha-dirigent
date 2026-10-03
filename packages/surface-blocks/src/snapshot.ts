/**
 * Signed read-only snapshots (PR-9 payload part).
 * Ed25519 (asymmetric): clients verify with a pinned PUBLIC key — no secret ever ships in a client.
 * Emission is fail-closed: any block above OFFLINE_MAX_SENSITIVITY ABORTS the whole snapshot
 * (no silent stripping), mirroring the platform's p_visibility philosophy.
 */

import {
  OFFLINE_MAX_SENSITIVITY,
  type SignedSnapshot,
  type SnapshotEnvelope
} from './types.js';
import { sensitivityWithinCap, validateSnapshotEnvelope, SensitivityError } from './validate.js';

/* ------------------------------ canonical JSON ------------------------------ */

/** Deterministic JSON: object keys sorted recursively; arrays keep order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/* ------------------------------ crypto helpers ------------------------------ */

const te = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = (globalThis.btoa ? globalThis.btoa(bin) : Buffer.from(bytes).toString('base64'));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  if (globalThis.atob) {
    const bin = globalThis.atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Ed25519Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  /** base64url public key */
  x: string;
  /** base64url private key (sign side only) */
  d?: string;
}

async function subtleSupportsEd25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey('Ed25519' as never, true, ['sign', 'verify']);
    return true;
  } catch (err) {
    // Not a swallowed error — this is a one-time capability probe. But its
    // `false` switches snapshot verification to the fallback path, and a
    // verification path that changes without anyone noticing is exactly the
    // silent degradation this codebase refuses. Say it once, out loud.
    console.warn(
      '[surface-blocks] WebCrypto Ed25519 unavailable; using the fallback verifier:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function nodeCrypto(): Promise<typeof import('node:crypto') | null> {
  if (typeof process === 'undefined' || !process.versions?.node) return null;
  const mod = 'node:crypto';
  return await import(/* @vite-ignore */ mod);
}

/** Generate a keypair (ops tooling / tests). Returns JWKs. */
export async function generateEd25519KeyPairJwk(): Promise<{ publicJwk: Ed25519Jwk; privateJwk: Ed25519Jwk }> {
  if (await subtleSupportsEd25519()) {
    const kp = (await crypto.subtle.generateKey('Ed25519' as never, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicJwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as Ed25519Jwk;
    const privateJwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as Ed25519Jwk;
    return { publicJwk, privateJwk };
  }
  const nc = await nodeCrypto();
  if (!nc) throw new Error('Ed25519 unavailable in this runtime');
  const { publicKey, privateKey } = nc.generateKeyPairSync('ed25519');
  return {
    publicJwk: publicKey.export({ format: 'jwk' }) as Ed25519Jwk,
    privateJwk: privateKey.export({ format: 'jwk' }) as Ed25519Jwk
  };
}

async function ed25519Sign(privateJwk: Ed25519Jwk, data: Uint8Array): Promise<Uint8Array> {
  if (await subtleSupportsEd25519()) {
    const key = await crypto.subtle.importKey('jwk', privateJwk as JsonWebKey, 'Ed25519' as never, false, ['sign']);
    const sig = await crypto.subtle.sign('Ed25519' as never, key, data as BufferSource);
    return new Uint8Array(sig);
  }
  const nc = await nodeCrypto();
  if (!nc) throw new Error('Ed25519 unavailable in this runtime');
  const key = nc.createPrivateKey({ key: privateJwk, format: 'jwk' } as unknown as Parameters<
    typeof nc.createPrivateKey
  >[0]);
  return new Uint8Array(nc.sign(null, data, key));
}

async function ed25519Verify(publicJwk: Ed25519Jwk, data: Uint8Array, sig: Uint8Array): Promise<boolean> {
  if (await subtleSupportsEd25519()) {
    const key = await crypto.subtle.importKey('jwk', publicJwk as JsonWebKey, 'Ed25519' as never, false, ['verify']);
    return crypto.subtle.verify('Ed25519' as never, key, sig as BufferSource, data as BufferSource);
  }
  const nc = await nodeCrypto();
  if (!nc) throw new Error('Ed25519 unavailable in this runtime');
  const key = nc.createPublicKey({ key: publicJwk, format: 'jwk' } as unknown as Parameters<
    typeof nc.createPublicKey
  >[0]);
  return nc.verify(null, data, key, sig);
}

/* ------------------------------ sign / verify ------------------------------ */

/**
 * Sign an envelope for publication. Fail-closed:
 *  - envelope must validate against the schema,
 *  - every block must be within OFFLINE_MAX_SENSITIVITY, otherwise the emission ABORTS.
 */
export async function signSnapshot(
  envelope: SnapshotEnvelope,
  privateJwk: Ed25519Jwk,
  keyId: string
): Promise<SignedSnapshot> {
  const val = validateSnapshotEnvelope(envelope);
  if (!val.ok) throw new Error(`snapshot envelope invalid: ${val.errors.join('; ')}`);
  if (!sensitivityWithinCap(envelope.max_sensitivity, OFFLINE_MAX_SENSITIVITY)) {
    throw new SensitivityError(`snapshot max_sensitivity '${envelope.max_sensitivity}' exceeds offline cap`);
  }
  for (const b of envelope.blocks) {
    if (!sensitivityWithinCap(b.sensitivity, envelope.max_sensitivity)) {
      throw new SensitivityError(
        `ABORT: block '${b.block_slug}' ('${b.sensitivity}') exceeds snapshot max_sensitivity — snapshots are never silently stripped`
      );
    }
  }
  const canonical = canonicalJson(envelope);
  const sha256 = await sha256Hex(canonical);
  const signature = b64urlEncode(await ed25519Sign(privateJwk, te.encode(canonical)));
  return { ...envelope, sha256, signature, key_id: keyId };
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** Client-side verification before rendering/caching a published snapshot. */
export async function verifySnapshot(
  signed: SignedSnapshot,
  publicJwk: Ed25519Jwk,
  now: Date = new Date()
): Promise<VerifyResult> {
  const { sha256, signature, key_id: _keyId, ...envelope } = signed;
  if (!sha256 || !signature) return { ok: false, reason: 'missing sha256/signature' };

  const val = validateSnapshotEnvelope(envelope);
  if (!val.ok) return { ok: false, reason: `schema: ${val.errors.join('; ')}` };

  if (!sensitivityWithinCap(envelope.max_sensitivity, OFFLINE_MAX_SENSITIVITY)) {
    return { ok: false, reason: 'max_sensitivity exceeds offline cap' };
  }
  for (const b of envelope.blocks) {
    if (!sensitivityWithinCap(b.sensitivity, envelope.max_sensitivity)) {
      return { ok: false, reason: `block '${b.block_slug}' exceeds max_sensitivity` };
    }
  }

  const expires = Date.parse(envelope.expires_at);
  if (!Number.isFinite(expires) || expires <= now.getTime()) {
    return { ok: false, reason: 'snapshot expired' };
  }

  const canonical = canonicalJson(envelope);
  if ((await sha256Hex(canonical)) !== sha256) return { ok: false, reason: 'sha256 mismatch' };

  const sigOk = await ed25519Verify(publicJwk, te.encode(canonical), b64urlDecode(signature));
  return sigOk ? { ok: true } : { ok: false, reason: 'signature invalid' };
}
