/**
 * ULID — self-contained implementation (no dependency), monotonic within
 * a process. 48-bit ms timestamp + 80 bits randomness, Crockford base32.
 */
import { randomBytes } from 'node:crypto';

// Crockford base32 — a public, standardized encoding alphabet, not a secret.
// eslint-disable-next-line no-secrets/no-secrets -- known constant (ULID spec)
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

let lastTime = -1;
let lastRandom: Uint8Array = new Uint8Array(10);

function encodeTime(time: number): string {
  let out = '';
  for (let i = 9; i >= 0; i--) {
    out = ALPHABET[time % 32] + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  // 10 bytes = 80 bits → 16 base32 chars
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.slice(0, 16);
}

function incrementRandom(bytes: Uint8Array): Uint8Array {
  const next = Uint8Array.from(bytes);
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i] === 0xff) {
      next[i] = 0;
    } else {
      next[i] += 1;
      return next;
    }
  }
  throw new Error('acs-sdk: ULID randomness overflow within one millisecond');
}

/** Generate a ULID; monotonic when called repeatedly in the same millisecond. */
export function ulid(now: number = Date.now()): string {
  if (now === lastTime) {
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = Uint8Array.from(randomBytes(10));
  }
  return encodeTime(now) + encodeRandom(lastRandom);
}

export function intentId(now?: number): string {
  return `int_${ulid(now)}`;
}

export function effectId(now?: number): string {
  return `eff_${ulid(now)}`;
}
