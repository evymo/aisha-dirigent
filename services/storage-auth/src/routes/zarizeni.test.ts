/**
 * Schopnost „zařízení“: vypnutá odpovídá, že je vypnutá; zapnutá vydá konfiguraci
 * pro QR, přijme jen APK a tablet si ho stáhne bez přihlášení.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

const OTISK = '4B:6E:9C:3E:90:DE:2B:9D:BF:76:5D:B2:B2:8F:B2:A7:20:5A:FB:23:B3:93:EA:5E:AC:13:5C:7F:BE:8A:28:00';
const IDENTITA = { applicationId: 'com.example.hlidac', kioskPackage: 'com.example.kiosk', certSha256: OTISK, versionName: '1.0.0', versionCode: 1 };

const s = vi.hoisted(() => ({
  config: {
    postgrestUrl: 'http://postgrest.test', postgrestServiceToken: 'sluzba',
    zarizeniBucket: 'zarizeni', maxApkMb: 1, storagePublicUrl: 'https://api.example.test/storage/v1',
  },
  // Co vrátí RPC `zarizeni_deklarace_cteni` (doslovný hlidac.json; null = nic
  // nedeklarováno) a jestli databáze vůbec odpoví.
  deklarace: null as Record<string, unknown> | null,
  databazeOdpovi: true,
  objekty: new Map<string, { data: Buffer; meta: Record<string, string> }>(),
  role: ['admin'] as string[],
  buckety: new Set<string>(),
}));

vi.mock('../config.js', () => ({ config: s.config }));
const { AuthError } = vi.hoisted(() => ({
  AuthError: class AuthError extends Error { constructor(public statusCode: number, m: string) { super(m); } },
}));
vi.mock('../auth.js', () => ({
  AuthError,
  verifyToken: async (h?: string) => { if (!h) throw new AuthError(401, 'missing'); return { userId: 'u', roles: s.role, claims: {} }; },
  isAdminOrStaff: (u: { roles: string[] }) => u.roles.includes('admin') || u.roles.includes('staff'),
}));
vi.mock('../minio.js', () => ({
  putObjectStream: async (b: string, k: string, stream: Readable, _n: number, meta: Record<string, string>) => {
    const c: Buffer[] = [];
    for await (const x of stream) c.push(x as Buffer);
    s.objekty.set(`${b}/${k}`, { data: Buffer.concat(c), meta });
  },
  statObjectOrNull: async (b: string, k: string) => {
    const o = s.objekty.get(`${b}/${k}`);
    return o ? { size: o.data.length, lastModified: new Date('2026-09-18T20:00:00Z'), metaData: o.meta } : null;
  },
  getObjectStream: async (b: string, k: string) => Readable.from([s.objekty.get(`${b}/${k}`)!.data]),
  zajistiBucket: async (b: string) => { s.buckety.add(b); },
  vypisKlice: async (b: string, prefix: string) =>
    [...s.objekty.keys()].filter((k) => k.startsWith(`${b}/${prefix}`)).map((k) => k.slice(b.length + 1)),
}));

import { zarizeniRoute } from './zarizeni.js';

/**
 * Normalizovaná identita (tvar, se kterým testy pracují) → DOSLOVNÝ hlidac.json,
 * jak ho hák dat instance zapíše do databáze.
 */
function syrova(n: Record<string, unknown>): Record<string, unknown> {
  const { kioskPackage, certSha256, timeZone, locale, ...zbytek } = n;
  return {
    ...zbytek,
    kiosk: { package: kioskPackage },
    signing: { certSha256 },
    ...(timeZone || locale ? { provisioning: { timeZone, locale } } : {}),
  };
}

// storage-auth čte deklaraci z databáze přes PostgREST — podvrhne se jen tahle RPC,
// cokoli jiného je chyba testu.
vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (url !== 'http://postgrest.test/rpc/zarizeni_deklarace_cteni') throw new Error(`neočekávaný fetch ${url}`);
  if ((init?.headers as Record<string, string>)?.Authorization !== 'Bearer sluzba') return new Response('', { status: 401 });
  if (!s.databazeOdpovi) return new Response('{"message":"db down"}', { status: 503 });
  return Response.json(s.deklarace === null ? null : { deklarace: s.deklarace, commit: 'abc', zapsano: '2026-09-26T20:00:00Z' });
});

async function app() {
  const a = Fastify();
  await a.register(zarizeniRoute);
  return a;
}
const APK = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('obsah apk')]);
const AUTH = { authorization: 'Bearer t' };

beforeEach(() => {
  s.deklarace = null;
  s.databazeOdpovi = true;
  s.objekty.clear();
  s.role = ['admin'];
});

describe('vypnutá schopnost', () => {
  it('administrace dostane „vypnuto“, tablet 404 not_configured', async () => {
    const a = await app();
    const k = await a.inject({ method: 'GET', url: '/zarizeni/konfigurace', headers: AUTH });
    expect(k.statusCode).toBe(200);
    expect(k.json()).toEqual({ zapnuto: false });
    const d = await a.inject({ method: 'GET', url: '/zarizeni/hlidac.apk' });
    expect(d.statusCode).toBe(404);
    expect(d.json()).toEqual({ error: 'not_configured' });
  });
});

describe('zapnutá schopnost', () => {
  // Deklarace nese otisk APK Kiosk Admina — bez něj se nahrání odmítne (test níž).
  const APK_SHA = createHash('sha256').update(APK).digest('hex');
  beforeEach(() => {
    s.deklarace = syrova({ ...IDENTITA, apk: { sha256: APK_SHA } });
  });

  it('⛔ APK s JINÝM otiskem, než slibuje deklarace → 409 a funkční Kiosk Admin zůstane', async () => {
    const a = await app();
    const hdr = { ...AUTH, 'content-type': 'application/vnd.android.package-archive' };
    expect((await a.inject({ method: 'PUT', url: '/zarizeni/hlidac', headers: hdr, payload: APK })).statusCode).toBe(200);
    const jiny = Buffer.concat([APK, Buffer.from('-jina-verze')]);
    const n = await a.inject({ method: 'PUT', url: '/zarizeni/hlidac', headers: hdr, payload: jiny });
    expect(n.statusCode).toBe(409);
    expect(n.json()).toMatchObject({ error: 'sha256_mismatch', deklarovano: APK_SHA });
    const d = await a.inject({ method: 'GET', url: '/zarizeni/hlidac.apk' });
    expect(d.rawPayload.equals(APK)).toBe(true);
  });

  it('⛔ deklarace bez otisku APK → nahrání se odmítne a nic se neuloží (revize 2026-09-24)', async () => {
    s.deklarace = syrova(IDENTITA);
    const a = await app();
    const n = await a.inject({ method: 'PUT', url: '/zarizeni/hlidac', headers: { ...AUTH, 'content-type': 'application/vnd.android.package-archive' }, payload: APK });
    expect(n.statusCode).toBe(409);
    expect(n.json()).toEqual({ error: 'sha256_not_declared' });
    expect([...s.objekty.keys()].some((k) => k.includes('hlidac/'))).toBe(false);
  });

  it('konfigurace nese vše pro QR a jen pro admina', async () => {
    const a = await app();
    s.role = ['member'];
    expect((await a.inject({ method: 'GET', url: '/zarizeni/konfigurace', headers: AUTH })).statusCode).toBe(403);
    s.role = ['staff'];
    const k = (await a.inject({ method: 'GET', url: '/zarizeni/konfigurace', headers: AUTH })).json();
    expect(k).toMatchObject({
      zapnuto: true,
      hlidac: { applicationId: 'com.example.hlidac', checksum: 'S26cPpDeK52_dl2yso-ypyBa-yOzk-perBNcf76KKAA', spravce: 'com.example.hlidac/platforma.hlidac.SpravceReceiver' },
      stazeni: 'https://api.example.test/storage/v1/zarizeni/hlidac.apk',
      apk: null,
    });
  });

  it('nahrané APK si tablet stáhne bez přihlášení, bajt po bajtu', async () => {
    const a = await app();
    const n = await a.inject({ method: 'PUT', url: '/zarizeni/hlidac', headers: { ...AUTH, 'content-type': 'application/vnd.android.package-archive' }, payload: APK });
    expect(n.statusCode).toBe(200);
    expect(n.json()).toMatchObject({ ok: true, bajtu: APK.length });
    // Bucket si storage-auth založí sám — minio-init ho nezakládá (ARG_MAX jádra).
    expect(s.buckety.has('zarizeni')).toBe(true);
    const d = await a.inject({ method: 'GET', url: '/zarizeni/hlidac.apk' });
    expect(d.statusCode).toBe(200);
    expect(d.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(d.rawPayload.equals(APK)).toBe(true);
    const k = (await a.inject({ method: 'GET', url: '/zarizeni/konfigurace', headers: AUTH })).json();
    expect(k.apk).toMatchObject({ bajtu: APK.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('cizí soubor ani přes strop se nenahraje a funkčního hlídače nepřepíše', async () => {
    const a = await app();
    const hdr = { ...AUTH, 'content-type': 'application/vnd.android.package-archive' };
    await a.inject({ method: 'PUT', url: '/zarizeni/hlidac', headers: hdr, payload: APK });
    expect((await a.inject({ method: 'PUT', url: '/zarizeni/hlidac', headers: hdr, payload: Buffer.from('MZ exe') })).statusCode).toBe(415);
    expect((await a.inject({ method: 'PUT', url: '/zarizeni/hlidac', headers: hdr, payload: Buffer.concat([APK, Buffer.alloc(2 * 1024 * 1024)]) })).statusCode).toBe(413);
    s.role = ['member'];
    expect((await a.inject({ method: 'PUT', url: '/zarizeni/hlidac', headers: hdr, payload: APK })).statusCode).toBe(403);
    const d = await a.inject({ method: 'GET', url: '/zarizeni/hlidac.apk' });
    expect(d.rawPayload.equals(APK)).toBe(true);
  });
});

describe('žádosti o nastavení tabletu', () => {
  // Tvar z `zaznamPinu` — tělo ho NESMÍ nést (viz lib/zadosti.ts).
  const PIN_ZAZNAM = 'pbkdf2_sha256$120000$ABEiM0RVZneImaq7zN3u/w==$q83vASNFZ4mrze8BI0VniavN7wEjRWeJq83vASNFZ4k=';
  const ZADOST = { poznamka: 'tablet 3', sit: { ssid: 'Dilna', zabezpeceni: 'WPA' }, okno: '02:00-04:00' };
  const post = (a: Awaited<ReturnType<typeof app>>, payload: unknown, headers: Record<string, string> = AUTH) =>
    a.inject({ method: 'POST', url: '/zarizeni/zadosti', headers, payload: payload as object });

  beforeEach(() => {
    s.deklarace = syrova(IDENTITA);
  });

  it('uloží žádost a výpis ji vrátí; verzi hlídače razítkuje server', async () => {
    const a = await app();
    const r = await post(a, ZADOST);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ ...ZADOST, autor: 'u', hlidac: { versionCode: 1, checksum: 'S26cPpDeK52_dl2yso-ypyBa-yOzk-perBNcf76KKAA' } });
    const v = (await a.inject({ method: 'GET', url: '/zarizeni/zadosti', headers: AUTH })).json();
    expect(v.zadosti).toHaveLength(1);
    expect(v.zadosti[0]).toMatchObject(ZADOST);
  });

  it('nejnovější první', async () => {
    const a = await app();
    await post(a, { ...ZADOST, poznamka: 'první' });
    await new Promise((r) => setTimeout(r, 5));
    await post(a, { ...ZADOST, poznamka: 'druhá' });
    const v = (await a.inject({ method: 'GET', url: '/zarizeni/zadosti', headers: AUTH })).json();
    expect(v.zadosti.map((z: { poznamka: string }) => z.poznamka)).toEqual(['druhá', 'první']);
  });

  it('⛔ heslo k Wi-Fi se neuloží — tělo, které ho nese, se odmítne CELÉ', async () => {
    const a = await app();
    const r = await post(a, { ...ZADOST, sit: { ...ZADOST.sit, heslo: 'tajne' } });
    expect(r.statusCode).toBe(400);
    expect([...s.objekty.keys()].some((k) => k.includes('zadosti/'))).toBe(false);
  });

  it('⛔ PIN se neuloží — ani čitelně, ani jako solený otisk', async () => {
    const a = await app();
    expect((await post(a, { ...ZADOST, pin: '482915' })).statusCode).toBe(400);
    expect((await post(a, { ...ZADOST, pinZaznam: PIN_ZAZNAM })).statusCode).toBe(400);
    expect([...s.objekty.keys()].some((k) => k.includes('zadosti/'))).toBe(false);
  });

  it('⛔ verzi hlídače si klient nenadiktuje', async () => {
    const a = await app();
    expect((await post(a, { ...ZADOST, hlidac: { versionCode: 99, checksum: 'x' } })).statusCode).toBe(400);
  });

  it('jen admin/staff — a vypnutá schopnost žádost nepřijme', async () => {
    const a = await app();
    s.role = ['member'];
    expect((await post(a, ZADOST)).statusCode).toBe(403);
    expect((await a.inject({ method: 'GET', url: '/zarizeni/zadosti', headers: AUTH })).statusCode).toBe(403);
    s.role = ['admin'];
    expect((await post(a, ZADOST, {})).statusCode).toBe(401);
    s.deklarace = null;
    expect((await post(a, ZADOST)).statusCode).toBe(404);
  });

  it('žádost bez Wi-Fi (síť nastaví technik ručně) je platná', async () => {
    const a = await app();
    const r = await post(a, { okno: '02:00-04:00' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ sit: null, poznamka: null });
  });
});

describe('hlídač se v seznamu appek nabízí sám sobě', () => {
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const RIDIC = { balicek: 'com.example.kiosk', versionCode: 12, versionName: '1.0.0', sha256: 'a'.repeat(64), velikostBajtu: 10 };
  const deklarace = (apkSha: string) =>
    syrova({ ...IDENTITA, versionCode: 4, apk: { soubor: 'zarizeni/hlidac.apk', sha256: apkSha, velikostBajtu: APK.length }, appky: [RIDIC] });
  const hdr = { ...AUTH, 'content-type': 'application/vnd.android.package-archive' };

  it('úložiště drží deklarovaný hlídač → nabídne se, a to jako POSLEDNÍ', async () => {
    s.deklarace = deklarace(sha(APK));
    const a = await app();
    expect((await a.inject({ method: 'PUT', url: '/zarizeni/hlidac', headers: hdr, payload: APK })).statusCode).toBe(200);
    // Otisk v metadatech = deklarovaný (`'a'×64`) — jinak by se appka nenabídla (test níž).
    s.objekty.set('zarizeni/appky/com.example.kiosk.apk', { data: Buffer.from('x'), meta: { sha256: RIDIC.sha256 } });
    const v = (await a.inject({ method: 'GET', url: '/zarizeni/appky' })).json();
    expect(v.appky.map((x: { balicek: string }) => x.balicek)).toEqual(['com.example.kiosk', 'com.example.hlidac']);
    expect(v.appky[1]).toMatchObject({ versionCode: 4, sha256: sha(APK), url: 'https://api.example.test/storage/v1/zarizeni/hlidac.apk' });
    expect(v.deklarovano).toBe(1);
  });

  it('⛔ úložiště drží JINÝ hlídač než deklarace → nenabízí se (tablet by jen hlásil nesoulad)', async () => {
    s.deklarace = deklarace('b'.repeat(64));
    s.objekty.set('zarizeni/hlidac/com.example.hlidac.apk', { data: APK, meta: { sha256: sha(APK) } });
    const a = await app();
    const v = (await a.inject({ method: 'GET', url: '/zarizeni/appky' })).json();
    expect(v.appky.some((x: { balicek: string }) => x.balicek === 'com.example.hlidac')).toBe(false);
  });

  it('⛔ appka, jejíž soubor v úložišti NESEDÍ otiskem s deklarací, se nenabízí', async () => {
    // NAMĚŘENO 2026-09-24: deklarace slibovala novou verzi, bucket držel starou.
    // Seznam ji nabídl, kiosk každou noc stáhl desítky MB a zahodil je.
    s.deklarace = deklarace(sha(APK));
    s.objekty.set('zarizeni/appky/com.example.kiosk.apk', { data: Buffer.from('stara-verze'), meta: { sha256: 'c'.repeat(64) } });
    const a = await app();
    const v = (await a.inject({ method: 'GET', url: '/zarizeni/appky' })).json();
    expect(v.appky.some((x: { balicek: string }) => x.balicek === 'com.example.kiosk')).toBe(false);
    // …a totéž, když otisk v metadatech úplně chybí (nahráno mimo ověřující cestu).
    s.objekty.set('zarizeni/appky/com.example.kiosk.apk', { data: Buffer.from('x'), meta: {} });
    const w = (await a.inject({ method: 'GET', url: '/zarizeni/appky' })).json();
    expect(w.appky.some((x: { balicek: string }) => x.balicek === 'com.example.kiosk')).toBe(false);
  });

  it('⛔ nenahraný hlídač se nenabízí', async () => {
    s.deklarace = deklarace(sha(APK));
    const a = await app();
    const v = (await a.inject({ method: 'GET', url: '/zarizeni/appky' })).json();
    expect(v.appky).toEqual([]);
  });
});

describe('⛔ databáze s deklarací neodpoví', () => {
  // Nedostupná deklarace NENÍ „vypnuto“: tablet by jinak v noci dostal prázdný
  // seznam a administrace by tvrdila, že schopnost zmizela. 503 = zkus později.
  beforeEach(() => {
    s.deklarace = syrova(IDENTITA);
    s.databazeOdpovi = false;
  });

  it('tablet (seznam appek i stažení) dostane 503 s Retry-After, ne 404 ani prázdný seznam', async () => {
    const a = await app();
    for (const url of ['/zarizeni/appky', '/zarizeni/hlidac.apk', '/zarizeni/appky/com.example.kiosk.apk']) {
      const r = await a.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(503);
      expect(r.json(), url).toEqual({ error: 'declaration_unavailable' });
      expect(r.headers['retry-after'], url).toBe('60');
    }
  });

  it('administrace dostane 503, ne „zapnuto: false“', async () => {
    const r = await (await app()).inject({ method: 'GET', url: '/zarizeni/konfigurace', headers: AUTH });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'declaration_unavailable' });
  });

  it('nepřihlášený pořád dostane 401 — o stavu databáze se nedozví', async () => {
    const r = await (await app()).inject({ method: 'GET', url: '/zarizeni/konfigurace' });
    expect(r.statusCode).toBe(401);
  });

  it('jakmile databáze odpoví, platí zase deklarace z ní', async () => {
    const a = await app();
    expect((await a.inject({ method: 'GET', url: '/zarizeni/konfigurace', headers: AUTH })).statusCode).toBe(503);
    s.databazeOdpovi = true;
    const k = await a.inject({ method: 'GET', url: '/zarizeni/konfigurace', headers: AUTH });
    expect(k.statusCode).toBe(200);
    expect(k.json()).toMatchObject({ zapnuto: true });
  });
});

describe('⛔ stahování balíčků má vlastní limit (tablety na LTE, 2026-09-28)', () => {
  it('obě stahovací trasy nesou úroveň device-download, seznam a zápisy ne', async () => {
    const { RATE_LIMIT_TIERS } = await import('@aisha/security');
    const a = Fastify();
    const trasy = new Map<string, unknown>();
    a.addHook('onRoute', (r) => {
      for (const m of [r.method].flat()) trasy.set(`${m} ${r.url}`, (r.config as { rateLimit?: unknown } | undefined)?.rateLimit);
    });
    await a.register(zarizeniRoute);
    await a.ready();
    // Měřidlo vidí trasy — jinak by prošlo naprázdno.
    expect(trasy.has('GET /zarizeni/appky/:balicek.apk')).toBe(true);
    expect(trasy.get('GET /zarizeni/appky/:balicek.apk')).toEqual(RATE_LIMIT_TIERS['device-download']);
    expect(trasy.get('GET /zarizeni/hlidac.apk')).toEqual(RATE_LIMIT_TIERS['device-download']);
    // Seznam sahá do databáze a úložiště — zůstává pod globálním limitem.
    expect(trasy.get('GET /zarizeni/appky')).toBeUndefined();
    expect(trasy.get('PUT /zarizeni/hlidac')).toBeUndefined();
  });
});

describe('hlášení tabletů → přehled zařízení (2026-09-28)', () => {
  const HLASENI = {
    zarizeni: '0f8fad5b-d9cb-469f-a165-70867728950e',
    model: 'samsung SM-X110',
    android: '14 (34)',
    kioskAdmin: { versionName: '1.0.0', versionCode: 1 },
    appky: [{ balicek: 'com.example.kiosk', versionCode: -1 }],
    webview: null,
    rezim: 'servis',
    stav: 'com.example.kiosk: stažení: server je přetížený (HTTP 429)',
  };
  const JSON_HDR = { 'content-type': 'application/json' };
  beforeEach(() => {
    s.deklarace = syrova(IDENTITA);
  });

  it('tablet hlásí bez přihlášení; administrace vidí hlášení i cílové verze', async () => {
    const a = await app();
    const p = await a.inject({ method: 'POST', url: '/zarizeni/hlaseni', headers: JSON_HDR, payload: HLASENI });
    expect(p.statusCode).toBe(204);
    const g = await a.inject({ method: 'GET', url: '/zarizeni/hlaseni', headers: AUTH });
    expect(g.statusCode).toBe(200);
    const telo = g.json();
    expect(telo.zarizeni).toHaveLength(1);
    expect(telo.zarizeni[0]).toMatchObject({ ...HLASENI, prvni: telo.zarizeni[0].prijato });
    expect(telo.appky).toEqual([]);
    expect(telo.kioskAdmin).toEqual({ balicek: 'com.example.hlidac', versionCode: 1, versionName: '1.0.0' });
  });

  it('další hlášení téhož tabletu přepíše stav, „poprvé" drží', async () => {
    const a = await app();
    await a.inject({ method: 'POST', url: '/zarizeni/hlaseni', headers: JSON_HDR, payload: HLASENI });
    const prvni = (await a.inject({ method: 'GET', url: '/zarizeni/hlaseni', headers: AUTH })).json().zarizeni[0].prvni;
    await new Promise((r) => setTimeout(r, 5));
    await a.inject({ method: 'POST', url: '/zarizeni/hlaseni', headers: JSON_HDR, payload: { ...HLASENI, stav: 'com.example.kiosk: nainstalováno.' } });
    const [h] = (await a.inject({ method: 'GET', url: '/zarizeni/hlaseni', headers: AUTH })).json().zarizeni;
    expect(h.stav).toBe('com.example.kiosk: nainstalováno.');
    expect(h.prvni).toBe(prvni);
    expect(h.prijato > prvni).toBe(true);
  });

  it('⛔ přehled jen pro správce', async () => {
    const a = await app();
    s.role = ['member'];
    expect((await a.inject({ method: 'GET', url: '/zarizeni/hlaseni', headers: AUTH })).statusCode).toBe(403);
    expect((await a.inject({ method: 'GET', url: '/zarizeni/hlaseni' })).statusCode).toBe(401);
  });

  it('⛔ vadné hlášení → 400 a nic se neuloží', async () => {
    const a = await app();
    const p = await a.inject({ method: 'POST', url: '/zarizeni/hlaseni', headers: JSON_HDR, payload: { ...HLASENI, heslo: 'x' } });
    expect(p.statusCode).toBe(400);
    expect(p.json()).toMatchObject({ error: 'invalid_report' });
    expect([...s.objekty.keys()].some((k) => k.includes('hlaseni/'))).toBe(false);
  });

  it('⛔ nad stropem zařízení se NOVÉ odmítne, známé hlásí dál', async () => {
    const { MAX_ZARIZENI } = await import('../lib/hlaseni.js');
    const a = await app();
    await a.inject({ method: 'POST', url: '/zarizeni/hlaseni', headers: JSON_HDR, payload: HLASENI });
    for (let i = 1; i < MAX_ZARIZENI; i++) s.objekty.set(`zarizeni/hlaseni/cizi-${i}.json`, { data: Buffer.from('{}'), meta: {} });
    const nove = await a.inject({
      method: 'POST', url: '/zarizeni/hlaseni', headers: JSON_HDR,
      payload: { ...HLASENI, zarizeni: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' },
    });
    expect(nove.statusCode).toBe(409);
    expect(nove.json()).toEqual({ error: 'device_limit' });
    expect((await a.inject({ method: 'POST', url: '/zarizeni/hlaseni', headers: JSON_HDR, payload: HLASENI })).statusCode).toBe(204);
  });

  it('vypnutá schopnost → 404 i pro hlášení', async () => {
    s.deklarace = null;
    const a = await app();
    expect((await a.inject({ method: 'POST', url: '/zarizeni/hlaseni', headers: JSON_HDR, payload: HLASENI })).statusCode).toBe(404);
  });
});
