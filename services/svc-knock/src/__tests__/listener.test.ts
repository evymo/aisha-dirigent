import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFrame, hexToBytes, totp, type Operator } from '@aisha/knock-protocol';
import { freshDeviceSecrets, nodeCrypto } from '@aisha/knock-protocol/node';
import type { Door } from '@aisha/knock-protocol/door';
import { configDefects, loadConfig, type KnockConfig } from '../config.js';
import { createDefense } from '../lib/defense.js';
import { createHandler, createNonceCache } from '../listener.js';

const KID = 'kid-neprusvitny-1';
const NOW = 1_770_000_000;

function operator(over: Partial<Operator> = {}): Operator {
  return { ...freshDeviceSecrets(), scopes: ['edge'], kind: 'device', ...over };
}

function ram(op: Operator, over: Partial<{ ts: number; scope: string; otp: number; ipFam: 0 | 4; ip: string }> = {}) {
  const ts = over.ts ?? NOW;
  return encodeFrame(
    nodeCrypto,
    {
      kid: KID, ts, scope: over.scope ?? 'edge',
      otp: over.otp ?? totp(nodeCrypto, hexToBytes(op.otpSeedHex), ts, 30, 6),
      ipFam: over.ipFam ?? 0, ip: over.ip ?? null,
    },
    hexToBytes(op.hmacKeyHex),
  ).frame;
}

/** Dveře jen na to, co listener volá — a s možností odmítnout zápis. */
function fakeDoor() {
  const otevrene: Array<{ ip: string; kid: string }> = [];
  const stav = { prijima: true, maStore: true };
  const door = {
    hasStore: () => stav.maStore,
    async open(ip: string, kid: string) {
      if (!stav.prijima) return false;
      otevrene.push({ ip, kid });
      return true;
    },
    async verdict() { return { allowed: false, via: 'closed' as const }; },
    async closeForKid() { return 0; },
  };
  return { door: door as unknown as Door, otevrene, stav };
}

function harness(cfgOver: Partial<KnockConfig> = {}, doorOver = fakeDoor()) {
  const zaznamy: Record<string, unknown>[] = [];
  const cfg: KnockConfig = {
    port: 0, bindHost: '127.0.0.1', redisUrl: 'redis://x', redisDb: 4,
    pinholeTtlSec: 120, windowSec: 30, otpStep: 30, otpDigits: 6, otpSkew: 1,
    operators: {}, staticAllow: [], blacklist: [],
    maxInvalid: 3, rateWindowSec: 60, cooldownSec: 300, recentOkSec: 3600,
    alertWebhook: '', logLevel: 'silent', diagnose: false,
    ...cfgOver,
  };
  const handle = createHandler({
    cfg,
    door: doorOver.door,
    defense: createDefense({ maxInvalid: cfg.maxInvalid, windowSec: cfg.rateWindowSec, cooldownSec: cfg.cooldownSec }),
    log: (o) => zaznamy.push(o),
    nonceSeen: createNonceCache(cfg.windowSec),
    now: () => NOW,
  });
  return { handle, zaznamy, ...doorOver, cfg };
}

describe('kontrakt prostředí — fail-closed', () => {
  const zaklad = { AISHA_SHARED_REDIS_URL: 'redis://x' } as NodeJS.ProcessEnv;

  it('bez operátorů se nestartuje — a řekne se, jak se dá jen měřit', () => {
    const d = configDefects(zaklad);
    expect(d.join(' ')).toMatch(/žádný operátor.*SPA_DIAGNOSE=1/s);
  });

  it('⛔ měřicí režim NESMÍ mít operátory, jinak to není měření', () => {
    const op = operator();
    const env = { ...zaklad, SPA_DIAGNOSE: '1', SPA_OPERATORS_B64: Buffer.from(JSON.stringify({ [KID]: op })).toString('base64') };
    expect(configDefects(env).join(' ')).toMatch(/čisté měření a nesmí mít operátory/);
  });

  it('bez mapy dveří se nestartuje — tichý knock, který nic neotevře, je horší než žádný', () => {
    expect(configDefects({ SPA_DIAGNOSE: '1' } as NodeJS.ProcessEnv).join(' ')).toMatch(/AISHA_SHARED_REDIS_URL chybí/);
  });

  it('⛔ prázdný klíč v rosteru neprojde ani sem', () => {
    const env = {
      ...zaklad,
      SPA_OPERATORS_B64: Buffer.from(JSON.stringify({ [KID]: { ...operator(), hmacKeyHex: '' } })).toString('base64'),
    };
    expect(configDefects(env).join(' ')).toMatch(/hmacKeyHex/);
  });

  it('zdravá konfigurace nemá vady a načte se', () => {
    const env = {
      ...zaklad,
      SPA_OPERATORS_B64: Buffer.from(JSON.stringify({ [KID]: operator() })).toString('base64'),
      SPA_KNOCK_PORT: '18181',
    };
    expect(configDefects(env)).toEqual([]);
    expect(loadConfig(env).port).toBe(18181);
  });
});

describe('zaťukání', () => {
  it('platný rámec otevře adresu, ze které přišel', async () => {
    const op = operator();
    const h = harness({ operators: { [KID]: op } });
    await h.handle(ram(op), '198.51.100.20');
    expect(h.otevrene).toEqual([{ ip: '198.51.100.20', kid: KID }]);
    expect(h.zaznamy.at(-1)).toMatchObject({ ev: 'OPEN', kid: KID });
  });

  it('cizí podpis neotevře nic', async () => {
    const op = operator();
    const h = harness({ operators: { [KID]: { ...op, ...freshDeviceSecrets() } } });
    await h.handle(ram(op), '198.51.100.20');
    expect(h.otevrene).toEqual([]);
    expect(h.zaznamy.at(-1)).toMatchObject({ ev: 'drop', reason: 'bad-hmac' });
  });

  it('nesmyslný datagram se zahodí a nespadne', async () => {
    const h = harness({ operators: { [KID]: operator() } });
    await h.handle(Uint8Array.from([1, 2, 3]), '198.51.100.20');
    expect(h.otevrene).toEqual([]);
    expect(String(h.zaznamy.at(-1)?.reason)).toMatch(/^decode:/);
  });

  it('týž rámec podruhé je replay', async () => {
    const op = operator();
    const h = harness({ operators: { [KID]: op } });
    const r = ram(op);
    await h.handle(r, '198.51.100.20');
    await h.handle(r, '198.51.100.20');
    expect(h.otevrene).toHaveLength(1);
    expect(h.zaznamy.at(-1)).toMatchObject({ ev: 'drop', reason: 'replay' });
  });

  it('⛔ zákaz místa neobejde ani platné zaťukání s adresou v rámci', async () => {
    const op = operator();
    const h = harness({ operators: { [KID]: op }, blacklist: ['203.0.113.66'] });
    await h.handle(ram(op, { ipFam: 4, ip: '203.0.113.66' }), '198.51.100.20');
    expect(h.otevrene).toEqual([]);
    expect(h.zaznamy.at(-1)).toMatchObject({ reason: 'blacklist', openIp: '203.0.113.66' });
  });

  it('omezení adres u operátora se testuje na TU, která se otevírá', async () => {
    const op = operator({ allowedIps: ['10.10.10.10'] });
    const h = harness({ operators: { [KID]: op } });
    await h.handle(ram(op), '198.51.100.20');
    expect(h.otevrene).toEqual([]);
    expect(h.zaznamy.at(-1)).toMatchObject({ reason: 'ip-not-allowed' });
  });

  it('⭐ měřicí režim NEOTEVÍRÁ, jen řekne, co doletělo', async () => {
    const op = operator();
    const h = harness({ diagnose: true, operators: {} });
    await h.handle(ram(op), '198.51.100.20');
    expect(h.otevrene).toEqual([]);
    expect(h.zaznamy.at(-1)).toMatchObject({ ev: 'rx', src: '198.51.100.20' });
  });

  it('⛔ když mapa zápis odmítne, NESMÍ se to tvářit jako otevřeno', async () => {
    const op = operator();
    const d = fakeDoor();
    d.stav.prijima = false;
    const h = harness({ operators: { [KID]: op } }, d);
    await h.handle(ram(op), '198.51.100.20');
    expect(h.zaznamy.at(-1)).toMatchObject({ ev: 'OPEN-FAILED' });
  });

  it('zaplavení nesmyslem spustí cooldown a další datagramy se ani nerozebírají', async () => {
    const h = harness({ operators: { [KID]: operator() }, maxInvalid: 3 });
    for (let i = 0; i < 5; i++) await h.handle(Uint8Array.from([9, 9, 9, i]), '203.0.113.9');
    expect(h.zaznamy.some((z) => z.ev === 'cooldown')).toBe(true);
    const pred = h.zaznamy.length;
    await h.handle(Uint8Array.from([9, 9, 9, 9]), '203.0.113.9');
    // Zahození cooldownem je TICHÉ — navenek k nerozeznání od běžného dropu (K2).
    expect(h.zaznamy.length).toBe(pred);
  });

  it('⭐ zastaralý kód u platného klíče NEVEDE k banu a volá si o nový kód', async () => {
    const op = operator();
    const podnety: Record<string, unknown>[] = [];
    const cfg = { operators: { [KID]: op } };
    const d = fakeDoor();
    const zaznamy: Record<string, unknown>[] = [];
    const handle = createHandler({
      cfg: { ...harness(cfg, d).cfg, ...cfg },
      door: d.door,
      defense: createDefense({ maxInvalid: 2, windowSec: 60, cooldownSec: 300 }),
      log: (o) => zaznamy.push(o),
      nonceSeen: createNonceCache(30),
      notify: (p) => podnety.push(p),
      now: () => NOW,
    });
    // Třikrát špatná číslice — s cizím klíčem by to dávno spustilo cooldown.
    for (let i = 0; i < 3; i++) await handle(ram(op, { otp: 100000 + i }), '198.51.100.20');
    expect(zaznamy.some((z) => z.ev === 'cooldown')).toBe(false);
    expect(podnety.some((p) => p.ev === 'fresh-code-due')).toBe(true);
  });
});

/**
 * ⛔ PORUCHA OVĚŘOVATELE NENÍ NEPLATNÝ PODPIS — A NESMÍ SHODIT DVEŘE.
 *
 * `ecdsaP256Verify` dřív vracel `false` i když se rozbil ověřovatel sám;
 * `false` znamená „podpis nesedí", takže se porucha tvářila jako odmítnutí
 * a nikdo si jí nevšiml — odmítnutí je tu ČEKANÝ stav. Po opravě primitivum
 * VYHAZUJE, což ale samo o sobě zavádí dvě nové vady, kdyby se neošetřila
 * hranice:
 *
 *   1. výjimka v obsluze `dgram` zprávy = `uncaughtException` = SPADLÝ DÉMON,
 *      takže z naší poruchy je nedostupnost dveří pro všechny;
 *   2. `drop()` krmí `defense.recordInvalid`, takže by si NEVINNÝ odesílatel
 *      za naši poruchu vysloužil cooldown a zápis mezi sousedskou aktivitu.
 *
 * Tenhle blok hlídá obě. Ověřuje se přes `hmacSha256`, protože pojistka
 * v listeneru obepíná CELÉ ověření, ne jednu větev.
 */
describe('porucha ověřovatele na hranici listeneru', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('zavřeno, nahlas, a BEZ postihu odesílatele', async () => {
    const op = operator();
    // Rámec se staví JEŠTĚ ZDRAVÝM primitivem — rozbíjíme až ověřování.
    const msg = ram(op);
    const h = harness({ operators: { [KID]: op } });

    vi.spyOn(nodeCrypto, 'hmacSha256').mockImplementation(() => {
      throw new Error('ověřovatel je rozbitý');
    });

    // 1) Démon PŘEŽIJE.
    await expect(h.handle(msg, '203.0.113.9')).resolves.toBeUndefined();

    // 2) Je to SLYŠET, a jako vlastní událost — ne schované mezi `drop`.
    const porucha = h.zaznamy.find((z) => z.ev === 'verifier-fault');
    expect(porucha, `záznamy: ${JSON.stringify(h.zaznamy)}`).toBeTruthy();
    expect(String(porucha?.chyba)).toMatch(/rozbitý/);

    // 3) Odesílatel za to NEMŮŽE: žádný `drop`, tedy ani `recordInvalid`.
    expect(h.zaznamy.filter((z) => z.ev === 'drop')).toEqual([]);

    // 4) A ZAVŘENO — porucha nesmí nic otevřít.
    expect(h.otevrene).toEqual([]);
  });
});
