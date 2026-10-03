/**
 * Kontrolní číslice — HOTP (RFC 4226) a TOTP (RFC 6238) nad HMAC-SHA256.
 *
 * Číslice sama o sobě nic neotevírá: rámec je podepsaný HMACem a číslice je
 * druhý, na klíči nezávislý faktor, který se dá rotovat („výměna zámku") bez
 * toho, aby se měnil klíč zařízení.
 */
import { writeUint64BE } from './bytes.js';
import type { KnockCrypto } from './crypto.js';

export function hotp(crypto: KnockCrypto, secret: Uint8Array, counter: number, digits = 6): number {
  const h = crypto.hmacSha256(secret, writeUint64BE(counter));
  // Dynamic truncation dle RFC 4226 §5.3 — poslední půlbajt určuje offset.
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return bin % 10 ** digits;
}

export function totp(
  crypto: KnockCrypto,
  secret: Uint8Array,
  forTimeSec: number,
  step = 30,
  digits = 6,
): number {
  return hotp(crypto, secret, Math.floor(forTimeSec / step), digits);
}
