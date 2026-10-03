import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bytesToHex, hexToBytes, utf8Decode, utf8Encode } from '../bytes.js';
import { decodeFrame, encodeFrame } from '../frame.js';
import { totp } from '../otp.js';
import { deriveFromPassword, freshDeviceSecrets, nodeCrypto } from '../node.js';
import {
  deservesFreshCode, operatorDefects, provesKeyPossession, verifyFrame,
  type Operator,
} from '../verify.js';

const KID = 'dev-telefon-1';
const SCOPE = 'api';
const NOW = 1_770_000_000;

function operator(over: Partial<Operator> = {}): Operator {
  const s = freshDeviceSecrets();
  return { ...s, scopes: [SCOPE], kind: 'device', ...over };
}

function knock(op: Operator, over: Partial<{ ts: number; scope: string; otp: number; nonce: string }> = {}) {
  const ts = over.ts ?? NOW;
  const otp = over.otp ?? totp(nodeCrypto, hexToBytes(op.otpSeedHex), ts, 30, 6);
  return encodeFrame(
    nodeCrypto,
    { kid: KID, ts, scope: over.scope ?? SCOPE, otp, nonce: over.nonce },
    hexToBytes(op.hmacKeyHex),
  );
}

const ctx = (operators: Record<string, Operator>, over: Partial<{ now: number; nonceSeen: (n: string) => boolean }> = {}) => ({
  crypto: nodeCrypto,
  operators,
  now: over.now ?? NOW,
  windowSec: 30,
  otpStep: 30,
  otpDigits: 6,
  otpSkew: 1,
  nonceSeen: over.nonceSeen,
});

describe('⭐ přenositelnost — jádro nesmí sáhnout na node:crypto', () => {
  it('jen adaptér `node.ts` smí importovat node:crypto, jinak by balíček v React Native neběžel', () => {
    const dir = join(import.meta.dirname, '..');
    const hrisnici: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f === 'node.ts') continue;
      const src = readFileSync(join(dir, f), 'utf8');
      // Komentáře o node:crypto jsou v pořádku; jde o skutečný import.
      if (/^\s*import[^\n]*['"]node:crypto['"]/m.test(src)) hrisnici.push(f);
    }
    expect(hrisnici).toEqual([]);
  });

  it('jádro nepoužívá Buffer — ten v React Native taky není', () => {
    const dir = join(import.meta.dirname, '..');
    const hrisnici: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f === 'node.ts') continue;
      const src = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      if (/\bBuffer\b/.test(src)) hrisnici.push(f);
    }
    expect(hrisnici).toEqual([]);
  });
});

describe('bajty', () => {
  it('UTF-8 přežije diakritiku i emoji', () => {
    for (const s of ['', 'api', 'ěščřžýáíé', 'zařízení Karla 🔑', 'a'.repeat(200)]) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });

  it('hex tam a zpět', () => {
    const b = Uint8Array.from([0, 1, 15, 16, 255]);
    expect(hexToBytes(bytesToHex(b))).toEqual(b);
  });

  it('lichý hex se odmítne, nedoplní', () => {
    expect(() => hexToBytes('abc')).toThrow(/lich/);
  });
});

describe('rámec', () => {
  it('round-trip zachová všechna pole', () => {
    const op = operator();
    const { frame, nonceHex } = knock(op);
    const d = decodeFrame(frame);
    expect(d).toMatchObject({ ver: 1, kid: KID, ts: NOW, scope: SCOPE, ipFam: 0, ip: null, nonce: nonceHex });
  });

  it('kid s diakritikou projde beze změny', () => {
    const op = operator();
    const otp = totp(nodeCrypto, hexToBytes(op.otpSeedHex), NOW, 30, 6);
    const { frame } = encodeFrame(
      nodeCrypto, { kid: 'zařízení-Řehoř', ts: NOW, scope: SCOPE, otp }, hexToBytes(op.hmacKeyHex),
    );
    expect(decodeFrame(frame).kid).toBe('zařízení-Řehoř');
  });

  it('výslovná IPv4 v rámci se přenese', () => {
    const op = operator();
    const otp = totp(nodeCrypto, hexToBytes(op.otpSeedHex), NOW, 30, 6);
    const { frame } = encodeFrame(
      nodeCrypto, { kid: KID, ts: NOW, scope: SCOPE, otp, ipFam: 4, ip: '198.51.100.20' }, hexToBytes(op.hmacKeyHex),
    );
    expect(decodeFrame(frame)).toMatchObject({ ipFam: 4, ip: '198.51.100.20' });
  });

  it('useknutý rámec se odmítne', () => {
    const { frame } = knock(operator());
    expect(() => decodeFrame(frame.subarray(0, frame.length - 5))).toThrow(/useknut/);
  });

  it('⛔ přebytečné bajty za rámcem se odmítnou — podpis by nekryl vše, co dorazilo', () => {
    const { frame } = knock(operator());
    const delsi = new Uint8Array(frame.length + 3);
    delsi.set(frame, 0);
    expect(() => decodeFrame(delsi)).toThrow(/přebyte/);
  });

  it('cizí značka se odmítne', () => {
    const { frame } = knock(operator());
    const jiny = Uint8Array.from(frame);
    jiny[0] = 0x58;
    expect(() => decodeFrame(jiny)).toThrow(/značka/);
  });
});

describe('ověření', () => {
  it('platný rámec projde', () => {
    const op = operator();
    const { frame } = knock(op);
    expect(verifyFrame(decodeFrame(frame), ctx({ [KID]: op }))).toEqual({ ok: true, reason: 'ok' });
  });

  it('neznámý kid padne první', () => {
    const { frame } = knock(operator());
    expect(verifyFrame(decodeFrame(frame), ctx({})).reason).toBe('unknown-kid');
  });

  it('⛔ prázdný klíč NEPROJDE jako platný podpis (fail-open z 2026-08-04)', () => {
    const op = operator();
    const { frame } = knock(op);
    const vadny: Operator = { ...op, hmacKeyHex: '' };
    expect(verifyFrame(decodeFrame(frame), ctx({ [KID]: vadny })).reason).toBe('operator-unusable');
  });

  it('⛔ chybějící scopes znamená DENY, ne „jakýkoli scope"', () => {
    const op = operator();
    const { frame } = knock(op);
    const vadny = { ...op, scopes: [] as string[] };
    expect(verifyFrame(decodeFrame(frame), ctx({ [KID]: vadny })).reason).toBe('operator-unusable');
  });

  it('cizí klíč → bad-hmac', () => {
    const op = operator();
    const { frame } = knock(op);
    const jiny: Operator = { ...op, ...freshDeviceSecrets() };
    expect(verifyFrame(decodeFrame(frame), ctx({ [KID]: jiny })).reason).toBe('bad-hmac');
  });

  it('rozejité hodiny → ts-window', () => {
    const op = operator();
    const { frame } = knock(op, { ts: NOW - 120 });
    expect(verifyFrame(decodeFrame(frame), ctx({ [KID]: op })).reason).toBe('ts-window');
  });

  it('opakovaný nonce → replay', () => {
    const op = operator();
    const { frame } = knock(op);
    expect(verifyFrame(decodeFrame(frame), ctx({ [KID]: op }, { nonceSeen: () => true })).reason).toBe('replay');
  });

  it('špatná číslice → bad-otp', () => {
    const op = operator();
    const { frame } = knock(op, { otp: 424242 });
    expect(verifyFrame(decodeFrame(frame), ctx({ [KID]: op })).reason).toBe('bad-otp');
  });

  it('cizí scope → scope-denied', () => {
    const op = operator({ scopes: ['ops'] });
    const { frame } = knock(op);
    expect(verifyFrame(decodeFrame(frame), ctx({ [KID]: op })).reason).toBe('scope-denied');
  });

  it('číslice o krok vedle projde díky toleranci', () => {
    const op = operator();
    const otpMinuly = totp(nodeCrypto, hexToBytes(op.otpSeedHex), NOW - 30, 30, 6);
    const { frame } = knock(op, { otp: otpMinuly });
    expect(verifyFrame(decodeFrame(frame), ctx({ [KID]: op })).ok).toBe(true);
  });
});

describe('⭐ klasifikace důvodů — na ní stojí, koho zabanovat', () => {
  it('kdo klíč NEMÁ, ban dostat může', () => {
    expect(provesKeyPossession('unknown-kid')).toBe(false);
    expect(provesKeyPossession('bad-hmac')).toBe(false);
  });

  it('kdo klíč MÁ, ban dostat nesmí — jinak se zařízení zabanuje samo', () => {
    for (const r of ['ts-window', 'replay', 'bad-otp', 'scope-denied']) {
      expect(provesKeyPossession(r)).toBe(true);
    }
  });

  it('nový kód si zaslouží jen „klíč sedí, kód ne"', () => {
    expect(deservesFreshCode('bad-otp')).toBe(true);
    expect(deservesFreshCode('ts-window')).toBe(true);
    // Poslal totéž dvakrát — nový kód nepomůže.
    expect(deservesFreshCode('replay')).toBe(false);
    // Nemá PRÁVO, ne špatný kód.
    expect(deservesFreshCode('scope-denied')).toBe(false);
  });
});

describe('materiál pověření', () => {
  it('krátký klíč se pojmenuje, ne spolkne', () => {
    const d = operatorDefects('x', { hmacKeyHex: 'aabb', otpSeedHex: 'cc'.repeat(20), scopes: ['api'] });
    expect(d.join(' ')).toMatch(/hmacKeyHex má 2 B/);
  });

  it('nehexadecimální materiál se pozná', () => {
    const d = operatorDefects('x', { hmacKeyHex: 'zzzz', otpSeedHex: 'cc'.repeat(20), scopes: ['api'] });
    expect(d.join(' ')).toMatch(/není hex/);
  });

  it('čerstvé pověření zařízení je bez vad', () => {
    expect(operatorDefects('x', { ...freshDeviceSecrets(), scopes: ['api'] })).toEqual([]);
  });

  it('odvození z hesla dá použitelný materiál a je deterministické', () => {
    const a = deriveFromPassword('tajne-heslo', 'clovek-1');
    const b = deriveFromPassword('tajne-heslo', 'clovek-1');
    expect(a).toEqual(b);
    expect(operatorDefects('clovek-1', { ...a, scopes: ['ops'] })).toEqual([]);
  });

  it('⭐ táž hesla u dvou lidí dají RŮZNÉ klíče (sůl z kid)', () => {
    expect(deriveFromPassword('tajne-heslo', 'clovek-1').hmacKeyHex)
      .not.toBe(deriveFromPassword('tajne-heslo', 'clovek-2').hmacKeyHex);
  });

  it('⭐ JÁDRO s injektovaným scryptem dá BAJTOVĚ TOTÉŽ co Node cesta', async () => {
    // Tohle je celý smysl přesunu do jádra: appka volá deriveCore se svým
    // KnockCrypto (quick-crypto) a MUSÍ dostat týž materiál jako Node — jinak by
    // kód člověka zadaný v telefonu server neověřil. Simulujeme appku tím, že
    // jádru dodáme scrypt z node:crypto přes rozhraní, ne přes node adaptér.
    const { deriveFromPassword: deriveCore } = await import('../derive.js');
    const nodeCryptoMod = await import('node:crypto');
    const injected = {
      hmacSha256: nodeCrypto.hmacSha256,
      randomBytes: nodeCrypto.randomBytes,
      scryptSync: (p: Uint8Array, s: Uint8Array, len: number, o: { N: number; r: number; p: number; maxmem: number }) =>
        new Uint8Array(nodeCryptoMod.scryptSync(Buffer.from(p), Buffer.from(s), len, o)),
    };
    expect(deriveCore(injected, 'tajne-heslo', 'clovek-1'))
      .toEqual(deriveFromPassword('tajne-heslo', 'clovek-1'));
  });

  it('⭐ jádro BEZ scryptu selže HLASITĚ, ne tichým prázdnem', async () => {
    const { deriveFromPassword: deriveCore } = await import('../derive.js');
    // Konzument bez kódu člověka (samotný UDP kontejner) scrypt nedodá; když ho
    // pak někdo přesto zavolá, musí to poznat hned, ne dostat vadný materiál.
    expect(() => deriveCore({ hmacSha256: nodeCrypto.hmacSha256, randomBytes: nodeCrypto.randomBytes }, 'x', 'k'))
      .toThrow(/scryptSync/);
  });
});
