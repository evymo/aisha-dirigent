import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeFrame, encodeFrame, encodeFrameDevice, VER, VER_DEVICE, SIG_BYTES,
} from '../frame.js';
import { operatorDefects, verifyFrame, type Operator } from '../verify.js';
import { nodeCrypto } from '../node.js';

/**
 * VER 2 — průkaz zařízení. Klíč nikdy neopustí telefon.
 *
 * Testy jsou psané tak, aby doložily i to, ČÍM SE TO DÁ OBEJÍT — samotné
 * „platný podpis projde" nic neříká o tom, že neplatné cesty jsou zavřené.
 */

/** Náhrada Secure Enclave: pár vznikne tady a soukromá půlka test neopustí. */
function zarizeni(): { pubHex: string; podepis: (m: Uint8Array) => Uint8Array } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const b = (s: string): Buffer => Buffer.from(s, 'base64url');
  const pub = Buffer.concat([Buffer.from([0x04]), b(jwk.x), b(jwk.y)]);
  return {
    pubHex: pub.toString('hex'),
    podepis: (m) =>
      new Uint8Array(
        crypto.createSign('SHA256').update(m).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }),
      ),
  };
}

const ted = (): number => Math.floor(Date.now() / 1000);
const opZar = (pubHex: string): Operator =>
  ({ publicKeyHex: pubHex, scopes: ['ops'], kind: 'device', ownedBy: 'nekdo' }) as Operator;

describe('VER 2 — rámec zařízení', () => {
  it('platný podpis projde a rámec nese verzi 2 bez OTP', () => {
    const d = zarizeni();
    const { frame } = encodeFrameDevice(nodeCrypto, { kid: 'dev-1', ts: ted(), scope: 'ops' }, d.podepis);
    const f = decodeFrame(frame);
    expect(f.ver).toBe(VER_DEVICE);
    expect(f.otp).toBeNull();
    expect(f.tag.length).toBe(SIG_BYTES);
    expect(verifyFrame(f, { operators: { 'dev-1': opZar(d.pubHex) }, crypto: nodeCrypto, now: ted(), windowSec: 30, otpStep: 30, otpDigits: 6 }))
      .toEqual({ ok: true, reason: 'ok' });
  });

  it('⛔ podpis CIZÍHO zařízení neprojde', () => {
    const a = zarizeni();
    const b = zarizeni();
    const { frame } = encodeFrameDevice(nodeCrypto, { kid: 'dev-1', ts: ted(), scope: 'ops' }, b.podepis);
    expect(verifyFrame(decodeFrame(frame), { operators: { 'dev-1': opZar(a.pubHex) }, crypto: nodeCrypto, now: ted(), windowSec: 30, otpStep: 30, otpDigits: 6 }).reason)
      .toBe('bad-sig');
  });

  it('⛔ změna jediného bajtu těla podpis zneplatní', () => {
    const d = zarizeni();
    const { frame } = encodeFrameDevice(nodeCrypto, { kid: 'dev-1', ts: ted(), scope: 'ops' }, d.podepis);
    frame[10] ^= 0x01;
    // Buď se rozbije rozklad, nebo neprojde podpis — obojí je odmítnutí.
    try {
      const f = decodeFrame(frame);
      expect(verifyFrame(f, { operators: { 'dev-1': opZar(d.pubHex) }, crypto: nodeCrypto, now: ted(), windowSec: 30, otpStep: 30, otpDigits: 6 }).ok).toBe(false);
    } catch (e) {
      expect(String(e)).toMatch(/rámec|verze|značka/);
    }
  });

  it('⛔ rámec ČLOVĚKA se nedá ověřit pověřením zařízení (a naopak)', () => {
    const d = zarizeni();
    const klic = new Uint8Array(32).fill(7);
    const { frame } = encodeFrame(nodeCrypto, { kid: 'dev-1', ts: ted(), scope: 'ops', otp: 123456 }, klic);
    expect(verifyFrame(decodeFrame(frame), { operators: { 'dev-1': opZar(d.pubHex) }, crypto: nodeCrypto, now: ted(), windowSec: 30, otpStep: 30, otpDigits: 6 }).reason)
      .toBe('ver-mismatch');
  });

  it('⛔ ověřovatel BEZ asymetrické operace nepropustí (a řekne proč)', () => {
    const d = zarizeni();
    const { frame } = encodeFrameDevice(nodeCrypto, { kid: 'dev-1', ts: ted(), scope: 'ops' }, d.podepis);
    const bezPodpisu = { hmacSha256: nodeCrypto.hmacSha256, randomBytes: nodeCrypto.randomBytes };
    expect(verifyFrame(decodeFrame(frame), { operators: { 'dev-1': opZar(d.pubHex) }, crypto: bezPodpisu, now: ted(), windowSec: 30, otpStep: 30, otpDigits: 6 }).reason)
      .toBe('verifier-incapable');
  });

  it('⛔ zařízení se sdíleným tajemstvím je VADNÉ pověření — to je smysl VER 2', () => {
    const d = zarizeni();
    const spatne = { ...opZar(d.pubHex), hmacKeyHex: 'ab'.repeat(32) } as Operator;
    const vady = operatorDefects('dev-1', spatne);
    expect(vady.join(' ')).toMatch(/NESMÍ mít hmacKeyHex/);
  });

  it('⛔ krátký nebo komprimovaný veřejný klíč se odmítne při zavedení', () => {
    expect(operatorDefects('dev-1', { publicKeyHex: 'ab'.repeat(10), scopes: ['ops'], kind: 'device' }).join(' '))
      .toMatch(/publicKeyHex má/);
    expect(operatorDefects('dev-1', { publicKeyHex: '02' + 'ab'.repeat(64), scopes: ['ops'], kind: 'device' }).join(' '))
      .toMatch(/nekomprimovaný/);
  });

  it('VER 1 zůstal beze změny — člověk pořád projde', () => {
    const klic = new Uint8Array(32).fill(9);
    const seed = 'ab'.repeat(20);
    const { frame } = encodeFrame(nodeCrypto, { kid: 'ops-1', ts: ted(), scope: 'ops', otp: 0 }, klic);
    const f = decodeFrame(frame);
    expect(f.ver).toBe(VER);
    expect(f.otp).toBe(0);
    const op = { hmacKeyHex: Buffer.from(klic).toString('hex'), otpSeedHex: seed, scopes: ['ops'], kind: 'person' } as Operator;
    // OTP nesedí, ale to je až ZA podpisem — důkaz, že HMAC větev pořád běží.
    expect(verifyFrame(f, { operators: { 'ops-1': op }, crypto: nodeCrypto, now: ted(), windowSec: 30, otpStep: 30, otpDigits: 6 }).reason)
      .toBe('bad-otp');
  });
});
