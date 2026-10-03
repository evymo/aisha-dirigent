/**
 * PUT /nahrani/:token — obsah teče přes API do úložiště. Skutečný Fastify
 * (inject), aby se měřilo, že tělo opravdu dorazí celé a nic navíc.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { Readable } from 'node:stream';

const { ulozeno, mockPromuj, mockZapis } = vi.hoisted(() => ({
  ulozeno: [] as Array<{ b: string; k: string; data: Buffer; meta: Record<string, string> }>,
  mockPromuj: vi.fn(),
  mockZapis: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    uploadTokenSecret: 's'.repeat(40),
    storagePublicUrl: 'https://api.example.test/storage/v1',
    uploadsQuarantineBucket: 'uploads-quarantine',
    publicBuckets: new Set(['page-assets']),
  },
}));
// Sken a promoce jsou za hranicí `promujZKaranteny` (lib/promoce.ts), který má vlastní
// strop skenu; tady se měří, KDY ho routa zavolá a jak jeho výsledek převede na HTTP.
vi.mock('../lib/promoce.js', () => ({ promujZKaranteny: mockPromuj }));
// Evidence médií (lib/media-zaznam.ts) má vlastní testy; tady se měří, KDY ji routa
// volá (jen veřejný bucket, jen po čisté promoci) a že její selhání PUT neshodí.
vi.mock('../lib/media-zaznam.js', () => ({ zapisMedium: mockZapis }));
vi.mock('../minio.js', () => ({
  putObjectStream: async (b: string, k: string, stream: Readable, _size: number, meta: Record<string, string>) => {
    const casti: Buffer[] = [];
    for await (const c of stream) casti.push(c as Buffer);
    ulozeno.push({ b, k, data: Buffer.concat(casti), meta });
  },
}));

import { nahraniRoute } from './nahrani.js';
import { vydejToken } from '../lib/nahravaci-token.js';

const TAJ = 's'.repeat(40);
const token = (o: Partial<{ t: string; max: number; exp: number }> = {}) =>
  vydejToken({ b: 'entity-evidence', k: 'u1/x_foto.jpg', t: 'image/jpeg', max: 1000, exp: Math.floor(Date.now() / 1000) + 60, ...o }, TAJ);

async function app() {
  const a = Fastify();
  await a.register(nahraniRoute);
  return a;
}

beforeEach(() => {
  ulozeno.length = 0;
  mockPromuj.mockReset();
  mockZapis.mockReset();
  mockPromuj.mockResolvedValue({ stav: 'cisty', bucket: 'entity-evidence', klic: 'u1/x_foto.jpg' });
  mockZapis.mockResolvedValue(undefined);
});

describe('nahrání přes API', () => {
  it('fotka s platným tokenem dojde do úložiště celá, pod klíčem z tokenu', async () => {
    const foto = Buffer.from('\xff\xd8\xff jpeg obsah', 'latin1');
    const r = await (await app()).inject({ method: 'PUT', url: `/nahrani/${token()}`, headers: { 'content-type': 'image/jpeg' }, payload: foto });
    expect(r.statusCode).toBe(200);
    expect(ulozeno).toHaveLength(1);
    expect(ulozeno[0]).toMatchObject({ b: 'entity-evidence', k: 'u1/x_foto.jpg', meta: { 'Content-Type': 'image/jpeg' } });
    expect(ulozeno[0].data.equals(foto)).toBe(true);
  });

  it('podvržený token, jiný typ nebo přes strop se nic neuloží', async () => {
    const a = await app();
    const [data] = token().split('.');
    expect((await a.inject({ method: 'PUT', url: `/nahrani/${data}.podpis`, headers: { 'content-type': 'image/jpeg' }, payload: 'x' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'PUT', url: `/nahrani/${token()}`, headers: { 'content-type': 'image/png' }, payload: 'x' })).statusCode).toBe(415);
    expect((await a.inject({ method: 'PUT', url: `/nahrani/${token({ max: 3 })}`, headers: { 'content-type': 'image/jpeg' }, payload: 'přes strop' })).statusCode).toBe(413);
    expect((await a.inject({ method: 'PUT', url: `/nahrani/${token({ exp: 1 })}`, headers: { 'content-type': 'image/jpeg' }, payload: 'x' })).statusCode).toBe(403);
    expect(ulozeno).toHaveLength(0);
  });
});

/**
 * ⛔ SKEN NA KONCI PUTU (dohodnuto 2026-09-23 s RIQ Driver).
 *
 * Tablety řidičů (1.0.0 build 12, 1.1.0 build 14) `upload-complete` neznají, klíč
 * z preflightu ukládají rovnou do záznamu a poběží, dokud hlídač nerozdá další build.
 * Když token míří do karantény, server proto sken a promoci udělá SÁM, hned jak tělo
 * doteče — a PUT vrátí konečný klíč, nebo chybu, kterou appka umí zpracovat.
 */
describe('token do karantény: sken a promoce na konci PUTu', () => {
  const doKaranteny = (o: Partial<{ k: string; d: string }> = {}) =>
    vydejToken({
      b: 'uploads-quarantine',
      k: 'entity-evidence/u1/x_foto.jpg',
      t: 'image/jpeg',
      max: 1000,
      exp: Math.floor(Date.now() / 1000) + 60,
      ...o,
    }, TAJ);

  const put = async (tok: string) =>
    (await app()).inject({ method: 'PUT', url: `/nahrani/${tok}`, headers: { 'content-type': 'image/jpeg' }, payload: 'foto' });

  it('čistý soubor → 200 s KONEČNÝM klíčem (ten, který tablet uložil z preflightu)', async () => {
    const r = await put(doKaranteny());
    expect(r.statusCode).toBe(200);
    expect(ulozeno[0]).toMatchObject({ b: 'uploads-quarantine', k: 'entity-evidence/u1/x_foto.jpg' });
    expect(mockPromuj).toHaveBeenCalledWith('entity-evidence/u1/x_foto.jpg', null);
    expect(r.json()).toMatchObject({ ok: true, bucket: 'entity-evidence', objectKey: 'u1/x_foto.jpg' });
  });

  it('infikovaný soubor → 422 (appka doklad neodešle)', async () => {
    mockPromuj.mockResolvedValue({ stav: 'infikovany', podpis: 'Eicar-Test-Signature' });
    const r = await put(doKaranteny());
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ error: 'infected' });
  });

  it('neprovedený sken → 502, NE úspěch (fail-closed, objekt zůstane v karanténě)', async () => {
    mockPromuj.mockResolvedValue({ stav: 'nedokonceno', duvod: 'clamd scan exceeded 60000ms' });
    const r = await put(doKaranteny());
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: 'scan_unavailable' });
  });

  it('zdravotní dokument BEZ documentId v tokenu → odmítnutí PŘED uložením', async () => {
    const r = await put(doKaranteny({ k: 'health-documents/u1/x.pdf' }));
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'token_tvar' });
    expect(ulozeno, 'bez řádku pro verdikt se nic neuloží').toHaveLength(0);
    expect(mockPromuj).not.toHaveBeenCalled();
  });

  it('zdravotní dokument S documentId → verdikt jde do TOHO řádku', async () => {
    mockPromuj.mockResolvedValue({ stav: 'cisty', bucket: 'health-documents', klic: 'u1/x.pdf' });
    const tok = vydejToken({
      b: 'uploads-quarantine', k: 'health-documents/u1/x.pdf', t: 'application/pdf',
      max: 1000, exp: Math.floor(Date.now() / 1000) + 60, d: 'doc-1',
    }, TAJ);
    const r = await (await app()).inject({
      method: 'PUT', url: `/nahrani/${tok}`, headers: { 'content-type': 'application/pdf' }, payload: '%PDF',
    });
    expect(r.statusCode).toBe(200);
    expect(mockPromuj).toHaveBeenCalledWith('health-documents/u1/x.pdf', 'doc-1');
  });

  it('token mimo karanténu (vydaný před zavedením, nebo schopnost bez skenu) → uloží se jako dřív, bez skenu', async () => {
    const r = await (await app()).inject({ method: 'PUT', url: `/nahrani/${token()}`, headers: { 'content-type': 'image/jpeg' }, payload: 'x' });
    expect(r.statusCode).toBe(200);
    expect(mockPromuj).not.toHaveBeenCalled();
  });

  it('privátní bucket se do evidence médií nezapisuje', async () => {
    await put(doKaranteny());
    expect(mockZapis).not.toHaveBeenCalled();
  });
});

/**
 * Evidence médií (2026-09-24): veřejný bucket = obsah webu → po čisté promoci záznam
 * pro galerii, s bajty a typem z PUTu. Selhání záznamu PUT NESHODÍ — objekt už je
 * čistý v cíli a webový klient vzápětí volá /upload-complete, které záznam zopakuje.
 */
describe('veřejný bucket: záznam média po čisté promoci', () => {
  const doVerejneho = () =>
    vydejToken({ b: 'uploads-quarantine', k: 'page-assets/u1/x_obr.jpg', t: 'image/jpeg', max: 1000, exp: Math.floor(Date.now() / 1000) + 60 }, TAJ);

  it('čistý obrázek → zapisMedium s klíčem, typem a bajty', async () => {
    mockPromuj.mockResolvedValue({ stav: 'cisty', bucket: 'page-assets', klic: 'u1/x_obr.jpg' });
    const r = await (await app()).inject({ method: 'PUT', url: `/nahrani/${doVerejneho()}`, headers: { 'content-type': 'image/jpeg' }, payload: 'obr' });
    expect(r.statusCode).toBe(200);
    expect(mockZapis).toHaveBeenCalledWith({ bucket: 'page-assets', objectKey: 'u1/x_obr.jpg', contentType: 'image/jpeg', bytes: 3 });
  });

  it('infikovaný obrázek se do evidence nedostane', async () => {
    mockPromuj.mockResolvedValue({ stav: 'infikovany', podpis: 'Eicar-Test-Signature' });
    await (await app()).inject({ method: 'PUT', url: `/nahrani/${doVerejneho()}`, headers: { 'content-type': 'image/jpeg' }, payload: 'obr' });
    expect(mockZapis).not.toHaveBeenCalled();
  });

  it('selhání záznamu PUT neshodí (upload-complete ho zopakuje)', async () => {
    mockPromuj.mockResolvedValue({ stav: 'cisty', bucket: 'page-assets', klic: 'u1/x_obr.jpg' });
    mockZapis.mockRejectedValue(new Error('record_media_asset failed: 500'));
    const r = await (await app()).inject({ method: 'PUT', url: `/nahrani/${doVerejneho()}`, headers: { 'content-type': 'image/jpeg' }, payload: 'obr' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, bucket: 'page-assets', objectKey: 'u1/x_obr.jpg' });
  });
});
