/**
 * Bajty bez `Buffer` — aby tenhle balíček běžel i tam, kde `Buffer` není.
 *
 * ⛔ PROČ NE `Buffer`
 * Drátový formát zaťukání musí mít JEDNO místo pravdy: bránu, samostatný UDP
 * kontejner i mobilní aplikaci. React Native `Buffer` ani `node:crypto` nemá
 * (změřeno 2026-08-06 v `mobile-app/package.json` — je tam jen `@cosmjs/crypto`),
 * takže balíček postavený na `Buffer` by se do appky nedal použít a skončilo by
 * to kopií formátu. Dvě kopie drátového formátu = dvě pravdy o tom, co je platný
 * rámec, a rozejdou se v nejhorší možnou chvíli.
 *
 * ⛔ PROČ NE `TextEncoder`
 * V Hermesu bývá, ale „bývá" není měření. UTF-8 kodér je dvacet řádků a nechá
 * balíček stát jen na tom, co je v jazyce samotném.
 */

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    // Náhradní pár (surrogate pair) — emoji a znaky mimo základní rovinu.
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i];
    if (c < 0x80) { s += String.fromCharCode(c); i += 1; }
    else if (c < 0xe0) { s += String.fromCharCode(((c & 0x1f) << 6) | (b[i + 1] & 0x3f)); i += 2; }
    else if (c < 0xf0) {
      s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f));
      i += 3;
    } else {
      const cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
      const v = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      i += 4;
    }
  }
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex má lichý počet znaků');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) throw new Error('hex obsahuje nehexadecimální znak');
    out[i] = b;
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function equals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Porovnání v konstantním čase — na podpis se nikdy nesmí použít `equals`.
 *
 * Rozdílná DÉLKA se prozradit může (a musí, jinak nejde vrátit false), ale obsah
 * ne: kdyby se porovnávalo se zkratem na prvním rozdílu, dal by se podpis
 * uhádnout bajt po bajtu podle toho, jak dlouho odpověď trvá.
 */
export function timingSafeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function writeUint64BE(value: number): Uint8Array {
  const out = new Uint8Array(8);
  let v = BigInt(Math.trunc(value));
  for (let i = 7; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

export function readUint64BE(b: Uint8Array, offset: number): number {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[offset + i]);
  // Nad 2^53 by se číslo tiše zaokrouhlilo; časové razítko sekund tam nikdy
  // nedosáhne, ale mlčet o tom by znamenalo dělat z chyby platný rámec.
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('časové razítko mimo bezpečný rozsah');
  return Number(v);
}

export function writeUint32BE(value: number): Uint8Array {
  const v = value >>> 0;
  return Uint8Array.from([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

export function readUint32BE(b: Uint8Array, offset: number): number {
  return ((b[offset] << 24) >>> 0) + (b[offset + 1] << 16) + (b[offset + 2] << 8) + b[offset + 3];
}
