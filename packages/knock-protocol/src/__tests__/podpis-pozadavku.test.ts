import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes, utf8Encode } from '../bytes.js';
import { nodeCrypto } from '../node.js';
import {
  DEVICE_REQUEST_HEADERS,
  deviceRequestHeadersFrom,
  deviceRequestSigningBytes,
  parseDeviceRequestHeaders,
  REQUEST_MAGIC,
  signDeviceRequest,
  verifyDeviceRequest,
  type DeviceRequest,
  type DeviceRequestVerifyContext,
} from '../request.js';
import { kidZKlice } from '../verify.js';

/**
 * Podpis HTTP požadavku průkazem zařízení.
 *
 * ⭐ ZAMRAŽENÉ VEKTORY. Kanonické bajty i podpisy níž NEVYROBIL tenhle balíček:
 * sestavil je samostatný skript ručním skládáním polí (Buffer.concat) a podepsal
 * Node klíčem, jehož soukromá půlka se zahodila. Test tedy porovnává DVĚ
 * implementace formátu, ne jednu samu se sebou. Když vektor přestane sedět,
 * změnil se drátový formát a každé nasazené zařízení přestane být slyšet —
 * správná reakce je nová `REQUEST_MAGIC`, ne přepsání vektoru.
 */
const VEKTOR_KLIC =
  '04cd176cc6b50fe4c945082ea1c8f4ab97e9d4676e405612d4d268dd7e4714e95079a461829ee3dc510bac9decb6a5cb9f08a4efb360bbb217ca0bcccea2f687ab';
const VEKTOR_KID = 'dev-cd176cc6b50fe4c9';

const VEKTORY = [
  {
    name: 'POST se sync tělem',
    request: {
      audience: 'devices',
      method: 'POST',
      target: '/v1/sync',
      body: utf8Encode('{"policyVersion":3,"installed":[{"package":"cz.example.app","versionCode":12}]}'),
    },
    ts: 1789600000,
    nonceHex: '000102030405060708090a0b0c0d0e0f',
    signingBytesHex:
      '41495348412d52455131076465766963657304504f5354000000082f76312f73796e63146465762d63643137366363366235306665346339000000006aab2100000102030405060708090a0b0c0d0e0f0000004f7b22706f6c69637956657273696f6e223a332c22696e7374616c6c6564223a5b7b227061636b616765223a22637a2e6578616d706c652e617070222c2276657273696f6e436f6465223a31327d5d7d',
    signatureHex:
      'c34cd0b9a455250bc408aef56d7f3dff897da91c65bdf99fc6f28030b14c47d5a96f41d992bbfe611d6c09364eaee3882838292710dc13b5233b8a4f5e9b9e51',
  },
  {
    name: 'GET bez těla s query',
    request: { audience: 'devices', method: 'GET', target: '/v1/releases/7f3c/apk?part=1' },
    ts: 1789600123,
    nonceHex: 'ffeeddccbbaa99887766554433221100',
    signingBytesHex:
      '41495348412d524551310764657669636573034745540000001c2f76312f72656c65617365732f376633632f61706b3f706172743d31146465762d63643137366363366235306665346339000000006aab217bffeeddccbbaa9988776655443322110000000000',
    signatureHex:
      'cb59e694816451df1ace8a5197c26b5b3547ef1764a9dc01cbac2e411be3618f70650a23892a90560f23a00f6c470cb9cae230037db6b9593d1e495bee200c01',
  },
] satisfies Array<{
  name: string;
  request: DeviceRequest;
  ts: number;
  nonceHex: string;
  signingBytesHex: string;
  signatureHex: string;
}>;

/** Náhrada Keystore: pár vznikne tady a soukromá půlka test neopustí. */
function zarizeni(): { pubHex: string; kid: string; podepis: (m: Uint8Array) => Uint8Array } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const b = (s: string): Buffer => Buffer.from(s, 'base64url');
  const pubHex = Buffer.concat([Buffer.from([0x04]), b(jwk.x), b(jwk.y)]).toString('hex');
  return {
    pubHex,
    kid: kidZKlice(pubHex),
    podepis: (m) =>
      new Uint8Array(crypto.createSign('SHA256').update(m).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })),
  };
}

const TED = 1789600000;

function kontext(over: Partial<DeviceRequestVerifyContext> = {}): DeviceRequestVerifyContext {
  const videne = new Set<string>();
  return {
    audience: 'devices',
    crypto: nodeCrypto,
    now: TED,
    windowSec: 120,
    claimNonce: (kid, nonce) => {
      const k = `${kid}:${nonce}`;
      if (videne.has(k)) return false;
      videne.add(k);
      return true;
    },
    ...over,
  };
}

const SYNC: DeviceRequest = { audience: 'devices', method: 'POST', target: '/v1/sync', body: utf8Encode('{"a":1}') };

describe('podpis požadavku — zamražené vektory', () => {
  for (const v of VEKTORY) {
    it(`${v.name}: kanonické bajty sedí s nezávislým sestavením`, () => {
      const bytes = deviceRequestSigningBytes({ ...v.request, kid: VEKTOR_KID, ts: v.ts, nonceHex: v.nonceHex });
      expect(bytesToHex(bytes)).toBe(v.signingBytesHex);
    });

    it(`${v.name}: uložený podpis projde ověřením`, () => {
      const headers = deviceRequestHeadersFrom(
        { kid: VEKTOR_KID, ts: v.ts, nonceHex: v.nonceHex },
        hexToBytes(v.signatureHex),
      );
      const verdict = verifyDeviceRequest(v.request, parseDeviceRequestHeaders(headers), VEKTOR_KLIC, kontext({ now: v.ts }));
      expect(verdict).toEqual({ ok: true, reason: 'ok', kid: VEKTOR_KID });
    });
  }

  it('kid vektoru je odvozený z klíče vektoru, ne vymyšlený', () => {
    expect(kidZKlice(VEKTOR_KLIC)).toBe(VEKTOR_KID);
  });

  it('⛔ doména je oddělená od rámce zaťukání (SPA1)', () => {
    expect(REQUEST_MAGIC).toBe('AISHA-REQ1');
    expect(bytesToHex(utf8Encode(REQUEST_MAGIC)).startsWith(bytesToHex(utf8Encode('SPA1')))).toBe(false);
  });
});

describe('podpis požadavku — ověření', () => {
  it('platný podpis projde a vrátí kid', () => {
    const d = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: d.kid, ts: TED }, d.podepis);
    expect(verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), d.pubHex, kontext())).toEqual({
      ok: true,
      reason: 'ok',
      kid: d.kid,
    });
  });

  const zmeny: Array<[string, Partial<DeviceRequest>]> = [
    ['metoda', { method: 'PUT' }],
    ['cíl', { target: '/v1/sync?x=1' }],
    ['tělo', { body: utf8Encode('{"a":2}') }],
    ['tělo jediným bajtem', { body: new Uint8Array([0]) }],
  ];
  for (const [co, zmena] of zmeny) {
    it(`⛔ změněná ${co} podpis zneplatní`, () => {
      const d = zarizeni();
      const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: d.kid, ts: TED }, d.podepis);
      const verdict = verifyDeviceRequest({ ...SYNC, ...zmena }, parseDeviceRequestHeaders(headers), d.pubHex, kontext());
      expect(verdict).toEqual({ ok: false, reason: 'bad-sig' });
    });
  }

  it('⛔ požadavek podepsaný pro jiného příjemce neprojde', () => {
    const d = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, audience: 'jiny-servis', kid: d.kid, ts: TED }, d.podepis);
    expect(verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), d.pubHex, kontext()).reason).toBe('bad-sig');
  });

  it('⛔ hranice polí nejde posunout: /a + tělo "b" ≠ /ab bez těla', () => {
    const id = { kid: 'dev-0000000000000000', ts: TED, nonceHex: '00'.repeat(16) };
    const a = deviceRequestSigningBytes({ audience: 'devices', method: 'POST', target: '/a', body: utf8Encode('b'), ...id });
    const b = deviceRequestSigningBytes({ audience: 'devices', method: 'POST', target: '/ab', ...id });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('⛔ podpis CIZÍHO zařízení neprojde', () => {
    const a = zarizeni();
    const b = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: a.kid, ts: TED }, b.podepis);
    expect(verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), a.pubHex, kontext()).reason).toBe('bad-sig');
  });

  it('neschválený nebo odvolaný průkaz (žádný klíč) = unknown-kid', () => {
    const d = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: d.kid, ts: TED }, d.podepis);
    expect(verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), null, kontext()).reason).toBe('unknown-kid');
  });

  it('⛔ klíč, ke kterému nesedí kid, je vada dat, ne platný průkaz', () => {
    const a = zarizeni();
    const b = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: a.kid, ts: TED }, b.podepis);
    // Podpis by s klíčem b prošel — kontrola kid musí zastavit dřív.
    expect(verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), b.pubHex, kontext()).reason).toBe(
      'credential-unusable',
    );
  });

  it('mimo časové okno = ts-window (až po ověření podpisu)', () => {
    const d = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: d.kid, ts: TED - 121 }, d.podepis);
    expect(verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), d.pubHex, kontext()).reason).toBe('ts-window');
  });

  it('⛔ přehraný požadavek neprojde podruhé', () => {
    const d = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: d.kid, ts: TED }, d.podepis);
    const ctx = kontext();
    expect(verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), d.pubHex, ctx).ok).toBe(true);
    expect(verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), d.pubHex, ctx)).toEqual({
      ok: false,
      reason: 'replay',
    });
  });

  it('⛔ nonce se nezabírá, když podpis nesedí', () => {
    const a = zarizeni();
    const b = zarizeni();
    const zabrane: string[] = [];
    const ctx = kontext({ claimNonce: (_k, n) => (zabrane.push(n), true) });
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: a.kid, ts: TED }, b.podepis);
    verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), a.pubHex, ctx);
    expect(zabrane).toEqual([]);
  });

  it('ověřovatel bez ecdsaP256Verify = verifier-incapable, ne bad-sig', () => {
    const d = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: d.kid, ts: TED }, d.podepis);
    const { ecdsaP256Verify: _pryc, ...bezOvereni } = nodeCrypto;
    expect(
      verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), d.pubHex, kontext({ crypto: bezOvereni })).reason,
    ).toBe('verifier-incapable');
  });
});

describe('podpis požadavku — tvar hlaviček a vstupu', () => {
  const platne = (): Record<string, string> => {
    const d = zarizeni();
    return signDeviceRequest(nodeCrypto, { ...SYNC, kid: d.kid, ts: TED }, d.podepis);
  };

  for (const jmeno of Object.values(DEVICE_REQUEST_HEADERS)) {
    it(`chybějící ${jmeno} = malformed`, () => {
      const h = platne();
      delete h[jmeno];
      expect(parseDeviceRequestHeaders(h)).toBeNull();
      expect(verifyDeviceRequest(SYNC, null, null, kontext()).reason).toBe('malformed');
    });
  }

  it.each([
    ['ts s písmenem', DEVICE_REQUEST_HEADERS.ts, '12a'],
    ['záporné ts', DEVICE_REQUEST_HEADERS.ts, '-5'],
    ['krátký nonce', DEVICE_REQUEST_HEADERS.nonce, 'abcd'],
    ['nonce velkými písmeny', DEVICE_REQUEST_HEADERS.nonce, 'AA'.repeat(16)],
    ['podpis v base64', DEVICE_REQUEST_HEADERS.signature, 'q'.repeat(88)],
    ['krátký podpis', DEVICE_REQUEST_HEADERS.signature, '00'.repeat(63)],
  ])('%s = malformed', (_n, header, value) => {
    const h = platne();
    h[header] = value;
    expect(parseDeviceRequestHeaders(h)).toBeNull();
  });

  it('pole hlaviček (duplicitní hlavička) = malformed', () => {
    const h: Record<string, string | string[]> = platne();
    h[DEVICE_REQUEST_HEADERS.kid] = ['dev-a', 'dev-b'];
    expect(parseDeviceRequestHeaders(h)).toBeNull();
  });

  it('vnější požadavek s mezerou v cíli = malformed, ne výjimka', () => {
    const d = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: d.kid, ts: TED }, d.podepis);
    expect(
      verifyDeviceRequest({ ...SYNC, target: '/v1/sync x' }, parseDeviceRequestHeaders(headers), d.pubHex, kontext()).reason,
    ).toBe('malformed');
  });

  it.each([
    ['malá metoda', { method: 'post' }],
    ['cíl bez lomítka', { target: 'v1/sync' }],
    ['audience velkými', { audience: 'Devices' }],
  ])('⛔ podepsat vadný požadavek nejde: %s', (_n, zmena) => {
    const d = zarizeni();
    expect(() => signDeviceRequest(nodeCrypto, { ...SYNC, ...zmena, kid: d.kid, ts: TED }, d.podepis)).toThrow();
  });

  it('⛔ vadná audience ověřovatele je chyba konfigurace, ne odmítnutí požadavku', () => {
    const d = zarizeni();
    const headers = signDeviceRequest(nodeCrypto, { ...SYNC, kid: d.kid, ts: TED }, d.podepis);
    expect(() =>
      verifyDeviceRequest(SYNC, parseDeviceRequestHeaders(headers), d.pubHex, kontext({ audience: 'Devices' })),
    ).toThrow(/audience/);
  });

  it('⛔ podpis špatné délky se neodešle', () => {
    expect(() =>
      signDeviceRequest(nodeCrypto, { ...SYNC, kid: 'dev-0000000000000000', ts: TED }, () => new Uint8Array(70)),
    ).toThrow(/64 bajtů/);
  });
});
