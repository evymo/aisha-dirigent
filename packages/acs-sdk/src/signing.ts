/**
 * Ed25519 message signing (R6). Keys come from the environment — never from
 * code or the repository (CLAUDE.md: No Secrets in Code).
 *
 *   ACS_SIGNING_KEY        base64 PKCS#8 private key (per service identity)
 *   ACS_TRUSTED_KEYS       JSON { "<sender-prefix>": "<base64 SPKI public key>", ... }
 *
 * The signature covers sha256(canonicalJson({ envelope-without-signature, payload })).
 */
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import type { AcsMessage, Envelope } from '@aisha/acs-contracts';
import { canonicalJson } from './canonicalJson.js';

export function signingDigest(envelope: Envelope, payload: object): Buffer {
  const { signature: _omit, ...unsigned } = envelope;
  return createHash('sha256').update(canonicalJson({ envelope: unsigned, payload })).digest();
}

export function loadPrivateKey(base64Pkcs8: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(base64Pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
}

export function loadPublicKey(base64Spki: string): KeyObject {
  return createPublicKey({ key: Buffer.from(base64Spki, 'base64'), format: 'der', type: 'spki' });
}

export function signMessage(message: AcsMessage, privateKey: KeyObject): string {
  const sig = edSign(null, signingDigest(message.envelope, message.payload), privateKey);
  return `ed25519:${sig.toString('base64')}`;
}

export function verifySignature(message: AcsMessage, publicKey: KeyObject): boolean {
  const value = message.envelope.signature;
  if (!value || !value.startsWith('ed25519:')) return false;
  const sig = Buffer.from(value.slice('ed25519:'.length), 'base64');
  return edVerify(null, signingDigest(message.envelope, message.payload), publicKey, sig);
}

export interface TrustStore {
  /** Resolve the public key for a sender identity, or null when unknown. */
  publicKeyFor(sender: string): KeyObject | null;
}

/** Trust store backed by the ACS_TRUSTED_KEYS env JSON (longest prefix wins). */
export function envTrustStore(env: NodeJS.ProcessEnv = process.env): TrustStore {
  let table: Record<string, string> = {};
  const raw = env['ACS_TRUSTED_KEYS'];
  if (raw) {
    try {
      table = JSON.parse(raw) as Record<string, string>;
    } catch {
      throw new Error('acs-sdk: ACS_TRUSTED_KEYS is not valid JSON');
    }
  }
  const cache = new Map<string, KeyObject>();
  return {
    publicKeyFor(sender: string): KeyObject | null {
      const prefix = Object.keys(table)
        .filter((p) => sender === p || sender.startsWith(`${p}.`))
        .sort((a, b) => b.length - a.length)[0];
      if (!prefix) return null;
      let key = cache.get(prefix);
      if (!key) {
        key = loadPublicKey(table[prefix]);
        cache.set(prefix, key);
      }
      return key;
    },
  };
}
