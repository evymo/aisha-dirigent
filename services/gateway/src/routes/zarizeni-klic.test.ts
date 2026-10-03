/**
 * Průkaz tabletu: ohlášení jen za otevřenými dveřmi a s důkazem klíče,
 * stav jen pro držitele klíče, roster dveřím jen s jejich tokenem.
 */
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { kidZKlice, signDeviceRequest } from '@aisha/knock-protocol';
import { nodeCrypto } from '@aisha/knock-protocol/node';

vi.mock('../config.js', () => ({
  config: { postgrestUrl: 'http://postgrest.test', knockUrl: 'http://knock.test:8080', postgrestJwtSecret: 'test-jwt-secret-0123456789abcdefghijklmnop' },
}));
const guardedFetch = vi.hoisted(() => vi.fn());
vi.mock('../lib/guarded-fetch.js', () => ({ guardedFetch, __resetGuard: () => {} }));

import {
  DEVICE_AUDIENCE,
  STROP_RELACI,
  dvereOtevrene,
  knockRosterRoutes,
  stejnyToken,
  vytvorNonceCache,
  zarizeniKlicRoutes,
} from './zarizeni-klic.js';
import { RELACE_ZARIZENI_ISS, RELACE_ZARIZENI_TTL_S } from '../auth/relace-zarizeni.js';

const JWT_SECRET_TEST = 'test-jwt-secret-0123456789abcdefghijklmnop';

/**
 * HS256 ověřený ručně: podpis musí sedět na tajemství, které čte PostgREST. (Brána OWASP A07
 * pouští `jose.jwtVerify` jen v @aisha/security/jwt — a ten ověřuje tokeny Keycloaku.)
 */
function overHs256(token: string, tajemstvi: string): Record<string, unknown> {
  const [hlavicka, telo, podpis] = token.split('.');
  expect(JSON.parse(Buffer.from(hlavicka, 'base64url').toString('utf8'))).toMatchObject({ alg: 'HS256' });
  const ocekavany = crypto.createHmac('sha256', tajemstvi).update(`${hlavicka}.${telo}`).digest('base64url');
  expect(podpis, 'podpis tokenu nesedí na JWT_SECRET').toBe(ocekavany);
  return JSON.parse(Buffer.from(telo, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function tablet() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const b = (s: string) => Buffer.from(s, 'base64url');
  const pubHex = Buffer.concat([Buffer.from([0x04]), b(jwk.x), b(jwk.y)]).toString('hex');
  return {
    pubHex,
    kid: kidZKlice(pubHex),
    podepis: (m: Uint8Array) =>
      new Uint8Array(crypto.createSign('SHA256').update(m).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })),
  };
}

function podepsane(t: ReturnType<typeof tablet>, method: string, target: string, telo: string) {
  return signDeviceRequest(
    nodeCrypto,
    { audience: DEVICE_AUDIENCE, method, target, body: new TextEncoder().encode(telo), kid: t.kid, ts: Math.floor(Date.now() / 1000) },
    t.podepis,
  );
}

const rpcVolani: { fn: string; params: Record<string, unknown> }[] = [];
let databaze: Record<string, unknown> = {};

beforeEach(() => {
  rpcVolani.length = 0;
  databaze = {};
  guardedFetch.mockReset();
  guardedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const m = /\/rpc\/([a-z_]+)$/.exec(String(url));
    if (!m) throw new Error(`neočekávaný fetch ${url}`);
    const params = JSON.parse(String(init?.body ?? '{}'));
    rpcVolani.push({ fn: m[1], params });
    return Response.json(databaze[m[1]] ?? null);
  });
});
afterEach(() => {
  delete process.env.KNOCK_ROSTER_TOKEN;
});

async function app(dvere: boolean) {
  const a = Fastify({ trustProxy: true });
  await a.register(zarizeniKlicRoutes, { prefix: '/auth/v1', dvere: async () => dvere });
  await a.register(knockRosterRoutes, { prefix: '/internal' });
  return a;
}

describe('ohlášení tabletu', () => {
  it('za otevřenými dveřmi a s podpisem ohlašovaného klíče vznikne ČEKAJÍCÍ průkaz', async () => {
    const t = tablet();
    const telo = JSON.stringify({ kid: t.kid, publicKeyHex: t.pubHex, scope: 'ops', verze: { ridic: '1.1.1 (15)' } });
    databaze.enrol_kiosk_device = { ok: true, stav: 'ceka' };
    const a = await app(true);
    const r = await a.inject({
      method: 'POST', url: '/auth/v1/device/enrol',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.83', ...podepsane(t, 'POST', '/auth/v1/device/enrol', telo) },
      payload: telo,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ kid: t.kid, stav: 'ceka' });
    expect(rpcVolani).toEqual([{ fn: 'enrol_kiosk_device', params: {
      p_kid: t.kid, p_public_key_hex: t.pubHex, p_scope: 'ops', p_ip: '198.51.100.83', p_verze: { ridic: '1.1.1 (15)' },
    } }]);
  });

  it('⛔ zavřené dveře → 403 a databáze se nic nedozví', async () => {
    const t = tablet();
    const telo = JSON.stringify({ kid: t.kid, publicKeyHex: t.pubHex, scope: 'ops' });
    const a = await app(false);
    const r = await a.inject({
      method: 'POST', url: '/auth/v1/device/enrol',
      headers: { 'content-type': 'application/json', ...podepsane(t, 'POST', '/auth/v1/device/enrol', telo) },
      payload: telo,
    });
    expect(r.statusCode).toBe(403);
    expect(rpcVolani).toEqual([]);
  });

  it('⛔ ohlášení cizího klíče (podpis jiným klíčem) → 401', async () => {
    const t = tablet();
    const cizi = tablet();
    const telo = JSON.stringify({ kid: cizi.kid, publicKeyHex: cizi.pubHex, scope: 'ops' });
    const a = await app(true);
    const r = await a.inject({
      method: 'POST', url: '/auth/v1/device/enrol',
      headers: { 'content-type': 'application/json', ...podepsane(t, 'POST', '/auth/v1/device/enrol', telo) },
      payload: telo,
    });
    expect(r.statusCode).toBe(401);
    expect(rpcVolani).toEqual([]);
  });

  it('⛔ změněné tělo po podpisu → 401; opakovaný požadavek → 401 replay', async () => {
    const t = tablet();
    const telo = JSON.stringify({ kid: t.kid, publicKeyHex: t.pubHex, scope: 'ops' });
    const hlavicky = podepsane(t, 'POST', '/auth/v1/device/enrol', telo);
    databaze.enrol_kiosk_device = { ok: true, stav: 'ceka' };
    const a = await app(true);
    const zmenene = await a.inject({
      method: 'POST', url: '/auth/v1/device/enrol',
      headers: { 'content-type': 'application/json', ...hlavicky },
      payload: telo.replace('"ops"', '"admin"'),
    });
    expect(zmenene.statusCode).toBe(401);
    const prvni = await a.inject({ method: 'POST', url: '/auth/v1/device/enrol', headers: { 'content-type': 'application/json', ...hlavicky }, payload: telo });
    expect(prvni.statusCode).toBe(200);
    const znovu = await a.inject({ method: 'POST', url: '/auth/v1/device/enrol', headers: { 'content-type': 'application/json', ...hlavicky }, payload: telo });
    expect(znovu.statusCode).toBe(401);
    expect(znovu.json()).toMatchObject({ duvod: 'replay' });
  });
});

describe('stav průkazu', () => {
  it('držitel klíče se dozví stav; cizí podpis ne', async () => {
    const t = tablet();
    databaze.kiosk_device_stav = { ok: true, stav: 'schvaleno', public_key_hex: t.pubHex };
    const a = await app(true);
    const r = await a.inject({ method: 'GET', url: '/auth/v1/device/stav', headers: podepsane(t, 'GET', '/auth/v1/device/stav', '') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ kid: t.kid, stav: 'schvaleno' });

    const cizi = tablet();
    const podvrh = { ...podepsane(cizi, 'GET', '/auth/v1/device/stav', ''), 'x-device-kid': t.kid };
    const r2 = await a.inject({ method: 'GET', url: '/auth/v1/device/stav', headers: podvrh });
    expect(r2.statusCode).toBe(401);
  });

  it('neznámý průkaz → 404', async () => {
    const t = tablet();
    databaze.kiosk_device_stav = { ok: false, error: 'nezname' };
    const a = await app(true);
    const r = await a.inject({ method: 'GET', url: '/auth/v1/device/stav', headers: podepsane(t, 'GET', '/auth/v1/device/stav', '') });
    expect(r.statusCode).toBe(404);
  });
});

describe('roster pro dveře', () => {
  it('⛔ bez nastaveného tokenu 503, se špatným 401, se správným jen veřejné klíče', async () => {
    const a = await app(true);
    expect((await a.inject({ method: 'GET', url: '/internal/knock/roster' })).statusCode).toBe(503);
    process.env.KNOCK_ROSTER_TOKEN = 'spravny-token-dveri';
    const b = await app(true);
    expect((await b.inject({ method: 'GET', url: '/internal/knock/roster', headers: { 'x-token': 'spatny' } })).statusCode).toBe(401);
    databaze.knock_roster_zarizeni = {
      operators: { 'dev-0123456789abcdef': { publicKeyHex: '04ab', scopes: ['ops'], kind: 'device' } },
      version: 'v1', count: 1,
    };
    const r = await b.inject({ method: 'GET', url: '/internal/knock/roster', headers: { 'x-token': 'spravny-token-dveri' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ 'dev-0123456789abcdef': { publicKeyHex: '04ab', scopes: ['ops'], kind: 'device' } });
    const v = await b.inject({ method: 'GET', url: '/internal/knock/roster/version', headers: { 'x-token': 'spravny-token-dveri' } });
    expect(v.json()).toEqual({ version: 'v1', count: 1 });
  });
});

describe('verdikt dveří', () => {
  it('204 = otevřeno; 403, výpadek i chybějící adresa = zavřeno (fail-closed)', async () => {
    guardedFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await dvereOtevrene('http://knock.test:8080/', '198.51.100.83')).toBe(true);
    expect(guardedFetch.mock.calls.at(-1)?.[0]).toBe('http://knock.test:8080/dvere');
    guardedFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await dvereOtevrene('http://knock.test:8080', '198.51.100.83')).toBe(false);
    guardedFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await dvereOtevrene('http://knock.test:8080', '198.51.100.83')).toBe(false);
    expect(await dvereOtevrene('', '198.51.100.83')).toBe(false);
    expect(await dvereOtevrene('http://knock.test:8080', undefined)).toBe(false);
  });
});

describe('pomocníci', () => {
  it('token se porovná celý a v konstantním čase', () => {
    expect(stejnyToken('abc', 'abc')).toBe(true);
    expect(stejnyToken('abc', 'abd')).toBe(false);
    expect(stejnyToken('abc', 'ab')).toBe(false);
    expect(stejnyToken('', '')).toBe(false);
  });

  it('nonce projde jednou, po vypršení okna znovu', () => {
    let t = 0;
    const claim = vytvorNonceCache(10, () => t);
    expect(claim('dev-a', 'n1')).toBe(true);
    expect(claim('dev-a', 'n1')).toBe(false);
    expect(claim('dev-b', 'n1')).toBe(true);
    t = 21_000;
    expect(claim('dev-a', 'n1')).toBe(true);
  });
});

describe('relace tabletu (F2-B) — vstup bez přihlášení jen po podpisu schváleného průkazu', () => {
  const cesta = '/auth/v1/device/session';
  const UCET = '11111111-2222-4333-8444-555555555555';

  it('schválený průkaz + podpis → krátký token účtu zařízení s device_kid; audit až PO podpisu', async () => {
    const t = tablet();
    databaze.kiosk_device_stav = { ok: true, stav: 'schvaleno', public_key_hex: t.pubHex };
    databaze.kiosk_vydej_relaci = { ok: true, ucet_id: UCET, kid: t.kid, plati_do: null };
    const a = await app(true);
    const r = await a.inject({ method: 'POST', url: cesta, headers: podepsane(t, 'POST', cesta, '') });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const telo = r.json() as { access_token: string; expires_in: number; kid: string; user: { id: string } };
    expect(telo).toMatchObject({ kid: t.kid, token_type: 'bearer', user: { id: UCET } });
    expect(telo.expires_in).toBeGreaterThan(800);
    expect(telo.expires_in).toBeLessThanOrEqual(RELACE_ZARIZENI_TTL_S);
    const payload = overHs256(telo.access_token, JWT_SECRET_TEST);
    expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(RELACE_ZARIZENI_TTL_S);
    expect(payload).toMatchObject({ role: 'authenticated', sub: UCET, aisha_user_id: UCET, device_kid: t.kid, iss: RELACE_ZARIZENI_ISS });
    expect(payload.jti).toBeTruthy();
    expect(rpcVolani.map((v) => v.fn)).toEqual(['kiosk_device_stav', 'kiosk_vydej_relaci']);
  });

  it('⛔ zavřené dveře → 403 a databáze se nic nedozví', async () => {
    const t = tablet();
    const a = await app(false);
    const r = await a.inject({ method: 'POST', url: cesta, headers: podepsane(t, 'POST', cesta, '') });
    expect(r.statusCode).toBe(403);
    expect(rpcVolani).toEqual([]);
  });

  it('⛔ cizí podpis pod kid schváleného tabletu → 401 a relace se NEvydá (žádný zápis)', async () => {
    const t = tablet();
    databaze.kiosk_device_stav = { ok: true, stav: 'schvaleno', public_key_hex: t.pubHex };
    databaze.kiosk_vydej_relaci = { ok: true, ucet_id: UCET, kid: t.kid, plati_do: null };
    const a = await app(true);
    const podvrh = { ...podepsane(tablet(), 'POST', cesta, ''), 'x-device-kid': t.kid };
    const r = await a.inject({ method: 'POST', url: cesta, headers: podvrh });
    expect(r.statusCode).toBe(401);
    expect(rpcVolani.map((v) => v.fn)).toEqual(['kiosk_device_stav']);
  });

  it('⛔ přehraný požadavek → 401 replay', async () => {
    const t = tablet();
    databaze.kiosk_device_stav = { ok: true, stav: 'schvaleno', public_key_hex: t.pubHex };
    databaze.kiosk_vydej_relaci = { ok: true, ucet_id: UCET, kid: t.kid, plati_do: null };
    const a = await app(true);
    const h = podepsane(t, 'POST', cesta, '');
    expect((await a.inject({ method: 'POST', url: cesta, headers: h })).statusCode).toBe(200);
    const r2 = await a.inject({ method: 'POST', url: cesta, headers: h });
    expect(r2.statusCode).toBe(401);
    expect(r2.json()).toMatchObject({ duvod: 'replay' });
  });

  it.each(['ceka', 'odvolano', 'neplatne'])('⛔ průkaz „%s“ → 403 hned, žádný token', async (duvod) => {
    const t = tablet();
    databaze.kiosk_device_stav = { ok: true, stav: duvod, public_key_hex: t.pubHex };
    databaze.kiosk_vydej_relaci = { ok: false, duvod };
    const a = await app(true);
    const r = await a.inject({ method: 'POST', url: cesta, headers: podepsane(t, 'POST', cesta, '') });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: 'neschvaleno', duvod });
  });

  it('relace nepřesáhne platnost průkazu; vypršelý průkaz = 403', async () => {
    const t = tablet();
    const za5min = new Date(Date.now() + 300_000).toISOString();
    databaze.kiosk_device_stav = { ok: true, stav: 'schvaleno', public_key_hex: t.pubHex };
    databaze.kiosk_vydej_relaci = { ok: true, ucet_id: UCET, kid: t.kid, plati_do: za5min };
    const a = await app(true);
    const r = await a.inject({ method: 'POST', url: cesta, headers: podepsane(t, 'POST', cesta, '') });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { expires_in: number }).expires_in).toBeLessThanOrEqual(300);

    databaze.kiosk_vydej_relaci = { ok: true, ucet_id: UCET, kid: t.kid, plati_do: new Date(Date.now() - 1_000).toISOString() };
    const r2 = await a.inject({ method: 'POST', url: cesta, headers: podepsane(t, 'POST', cesta, '') });
    expect(r2.statusCode).toBe(403);
  });

  it('strop relací na průkaz: po vyčerpání 429 (a do DB se nezapisuje)', async () => {
    const t = tablet();
    databaze.kiosk_device_stav = { ok: true, stav: 'schvaleno', public_key_hex: t.pubHex };
    databaze.kiosk_vydej_relaci = { ok: true, ucet_id: UCET, kid: t.kid, plati_do: null };
    const a = await app(true);
    for (let i = 0; i < STROP_RELACI; i++) {
      expect((await a.inject({ method: 'POST', url: cesta, headers: podepsane(t, 'POST', cesta, '') })).statusCode).toBe(200);
    }
    rpcVolani.length = 0;
    const r = await a.inject({ method: 'POST', url: cesta, headers: podepsane(t, 'POST', cesta, '') });
    expect(r.statusCode).toBe(429);
    expect(rpcVolani.map((v) => v.fn)).toEqual(['kiosk_device_stav']);
  });
});
