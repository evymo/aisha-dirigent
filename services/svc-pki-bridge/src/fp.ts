/**
 * Fingerprint helpers — for diagnostic comparison of secrets/tokens between
 * components WITHOUT leaking the actual secret value.
 *
 * Pattern: SHA-256 first 12 hex chars. 6 bytes entropy is enough to
 * visually compare ("a3f2c9..." == "a3f2c9...") but is computationally
 * infeasible to reverse to the original secret. Length and a one-char
 * type tag are added so two values that share a fp prefix but differ in
 * length still surface as distinct.
 *
 * Usage:
 *   import { fp, fpJwt } from './fp.js';
 *   logger.info({ secret_fp: fp(client_secret) }, 'loaded client secret');
 *   logger.info({ jwt_sig_fp: fpJwt(token) }, 'received token');
 *
 * Compare values across components by grepping for matching fp prefixes.
 *
 * @module
 */
import { createHash } from 'node:crypto';

/** Stringify a secret to a 12-char SHA-256 prefix + length tag. */
export function fp(secret: string | Buffer | undefined | null): string {
  if (secret == null || secret.length === 0) return '(empty)';
  const buf = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  return `${hash}/${buf.length}`;
}

/**
 * Fingerprint a JWT by hashing ONLY its signature segment (3rd dot-segment).
 * The signature is unique per (header, payload, signing key) and reveals
 * nothing about the payload — so an operator comparing token fp's across
 * components can confirm "this is the same token" without exposing claims.
 */
export function fpJwt(token: string | undefined | null): string {
  if (!token) return '(empty)';
  const parts = token.split('.');
  if (parts.length !== 3) return '(not-a-jwt)';
  return fp(parts[2]);
}

/**
 * Fingerprint a JWKS key by its `kid` only — `kid` is already a public ID,
 * but we wrap it for consistent display alongside other fingerprints.
 */
export function fpKid(kid: string | undefined): string {
  if (!kid) return '(no-kid)';
  return `kid:${kid.slice(0, 12)}…`;
}
