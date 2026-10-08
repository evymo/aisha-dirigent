// Vynucovací bod proti falešnému enginu (CI rovina kontraktu jádra 0c, §H).
// Identita vstupu se v testu podstrčí přes `adresy` (v provozu VŽDY ze socketu —
// hlídá to test „výchozí adresy ze socketu“ níž). Falešný engine zapisuje, co dostal,
// takže každé „odmítnuto“ má i důkaz „nic neprošlo k enginu“.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { request } from 'undici';
import type { FastifyInstance } from 'fastify';
import type { Duvod } from '@aisha/accel-protokol';
import { Kvoty, knihaVPameti, type Kniha } from '../kvoty.js';
import type { Pripravenost } from '../pripravenost.js';
import { vytvorVstup, type Upstream } from '../vstup.js';
import { postavTabulku, type Engine, type Tabulka } from '../tabulka.js';
import type { StavClenstvi } from '../clenstvi.js';
import { IP_ALFA, IP_Z, KLIC_ALFA, KLIC_Z, clenstviOk, uzel } from './fixtura.js';

type Pozadavek = { cesta: string; telo: unknown };
const engine = { pozadavky: [] as Pozadavek[], zpozdeni_ms: 0, status: 200, preruseno: 0 };
let fake: Server;
let fakeUrl = '';

beforeAll(async () => {
  fake = createServer((req, res) => {
    let kusy = '';
    req.on('data', (c) => (kusy += c));
    req.on('end', () => {
      const telo = kusy ? JSON.parse(kusy) : null;
      engine.pozadavky.push({ cesta: req.url ?? '', telo });
      let hotovo = false;
      res.on('close', () => {
        if (!hotovo) engine.preruseno++;
      });
      setTimeout(() => {
        hotovo = true;
        if (engine.status !== 200) {
          res.writeHead(engine.status, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'TAJNY-OBSAH-ENGINU vstup je delší než okno' }));
        }
        if (req.url === '/tokenize') {
          // Falešný tokenizér: token = znak (bez speciálních tokenů, jak VB žádá).
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ count: [...String((telo as { prompt?: string } | null)?.prompt ?? '')].length }));
        }
        const vstupy: string[] = (telo as { input?: string[] } | null)?.input ?? [];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', model: (telo as { model?: string } | null)?.model, data: vstupy.map((s, i) => ({ object: 'embedding', index: i, embedding: [s.length, i, 0.5] })), usage: { prompt_tokens: 3 } }));
      }, engine.zpozdeni_ms);
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => fake.close(() => r())));

const upstream: Upstream = {
  async post(e: Engine, cesta, telo, signal) {
    const r = await request(`${e.url}${cesta}`, { method: 'POST', body: JSON.stringify(telo), headers: { 'content-type': 'application/json' }, signal });
    return { status: r.statusCode, telo: await r.body.json() };
  },
};

function sestav(opts: { kniha?: Kniha; r5?: () => Duvod | null; tabulka?: () => Tabulka | { necitelna: string }; clenstvi?: () => StavClenstvi; uprav?: Parameters<typeof uzel>[0] } = {}) {
  const u = uzel((x) => {
    for (const e of Object.values(x.enginy)) e.url = fakeUrl;
    opts.uprav?.(x);
  });
  const r = postavTabulku(u);
  if ('vady' in r) throw new Error(r.vady.join('\n'));
  const t: Tabulka = r.tabulka;
  const zaznamy: Array<[string, Record<string, unknown>]> = [];
  const kvoty = new Kvoty(opts.kniha ?? knihaVPameti());
  const app = vytvorVstup({
    tabulka: opts.tabulka ?? (() => t),
    pripravenost: { rozhodni: opts.r5 ?? (() => null) } as unknown as Pripravenost,
    clenstvi: opts.clenstvi ?? (() => clenstviOk()),
    kvoty,
    upstream,
    adresy: (req) => ({ lokalni: String(req.headers['x-test-lokalni'] ?? ''), vzdalena: String(req.headers['x-test-vzdalena'] ?? '') }),
    zaznam: (u2, d) => zaznamy.push([u2, d]),
  });
  return { app, t, kvoty, zaznamy };
}

const ZA_Z = { 'x-test-lokalni': IP_Z.vstup, 'x-test-vzdalena': IP_Z.klient };
const ZA_ALFA = { 'x-test-lokalni': IP_ALFA.vstup, 'x-test-vzdalena': IP_ALFA.klient };
const embed = (app: FastifyInstance, hlavicky: Record<string, string>, telo: unknown = { model: 'embed-v1', input: ['ahoj'] }) =>
  app.inject({ method: 'POST', url: '/v1/embeddings', headers: { 'x-aisha-trida': 'dotaz', 'content-type': 'application/json', ...hlavicky }, payload: JSON.stringify(telo) });

beforeEach(() => {
  engine.pozadavky = [];
  engine.zpozdeni_ms = 0;
  engine.status = 200;
  engine.preruseno = 0;
});

describe('vstup a klíč (I1–I8)', () => {
  it('kotva: Z se svým klíčem svým vstupem = 200, identita v odpovědi (EM2), engine dostal přeložený model', async () => {
    const { app } = sestav();
    const r = await embed(app, { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['x-aisha-identita']).toBe(`safetensors:${'a'.repeat(64)}`);
    expect(r.headers['x-aisha-revize']).toBe('b'.repeat(40));
    expect(Number(r.headers['x-aisha-gpu-ms'])).toBeGreaterThanOrEqual(0);
    expect(r.json().model).toBe('embed-v1');
    expect(engine.pozadavky).toEqual([{ cesta: '/v1/embeddings', telo: { model: 'embed-1', input: ['ahoj'], encoding_format: 'float' } }]);
  });

  it('bez klíče = 401 KLIC_CHYBI, odmítl vstup, nic k enginu (I1)', async () => {
    const { app } = sestav();
    const r = await embed(app, ZA_Z);
    expect([r.statusCode, r.json().duvod, r.headers['x-aisha-odmitl']]).toEqual([401, 'KLIC_CHYBI', 'vstup']);
    expect(Object.keys(r.json())[0]).toBe('duvod');
    expect(engine.pozadavky).toEqual([]);
  });

  it('klíč ALFA vstupem Z = 403 KLIC_JINEHO_VSTUPU; klíč Z vstupem ALFA totéž (I3, I4)', async () => {
    const { app } = sestav();
    expect((await embed(app, { ...ZA_Z, authorization: `Bearer ${KLIC_ALFA}` })).json().duvod).toBe('KLIC_JINEHO_VSTUPU');
    expect((await embed(app, { ...ZA_ALFA, authorization: `Bearer ${KLIC_Z}` })).json().duvod).toBe('KLIC_JINEHO_VSTUPU');
    expect(engine.pozadavky).toEqual([]);
  });

  it('weak host: klient Z doručený na adresu vstupu ALFA i s klíčem ALFA = 403 VSTUP_NEZNAMY (MN1)', async () => {
    const { app } = sestav();
    const r = await embed(app, { 'x-test-lokalni': IP_ALFA.vstup, 'x-test-vzdalena': IP_Z.klient, authorization: `Bearer ${KLIC_ALFA}` });
    expect([r.statusCode, r.json().duvod]).toEqual([403, 'VSTUP_NEZNAMY']);
    expect(engine.pozadavky).toEqual([]);
  });

  it('nečitelná deklarace = 503 DEKLARACE_NECITELNA pro všechny, žádná stará tabulka (X3)', async () => {
    const { app } = sestav({ tabulka: () => ({ necitelna: 'zod' }) });
    const r = await embed(app, { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` });
    expect([r.statusCode, r.json().duvod]).toEqual([503, 'DEKLARACE_NECITELNA']);
  });

  it('klíč ani jeho část se nikdy neobjeví v záznamu (KJ3, D2)', async () => {
    const { app, zaznamy } = sestav();
    await embed(app, { ...ZA_Z, authorization: `Bearer ${KLIC_ALFA}` });
    await embed(app, { ...ZA_Z, authorization: 'Bearer neznamy-klic-xyz' });
    const text = JSON.stringify(zaznamy);
    expect(zaznamy.length).toBe(2);
    for (const k of [KLIC_ALFA, 'neznamy-klic-xyz', KLIC_ALFA.slice(0, 8)]) expect(text).not.toContain(k);
    expect(zaznamy[0][1].otisk).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('pole platformy a tvar (I5, PT2, V3, MJ26)', () => {
  const sKlicem = { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` };
  it('hlavička identity od klienta = 400 POLE_PLATFORMY s jménem pole, nic nezapočteno ani posláno (I5)', async () => {
    const { app, kvoty, t } = sestav();
    const r = await embed(app, { ...sKlicem, 'x-aisha-najemce': 'alfa' });
    expect([r.statusCode, r.json().duvod, r.json().pole]).toEqual([400, 'POLE_PLATFORMY', 'x-aisha-najemce']);
    expect(JSON.stringify(r.json())).not.toContain('alfa');
    expect(engine.pozadavky).toEqual([]);
    expect(kvoty.agregat(t.najemci.get('z')!).gpu_ms).toBe(0);
  });
  it('cache_salt v těle = POLE_PLATFORMY, nepřepíše se potichu (PT2, MJ25/26)', async () => {
    const { app } = sestav();
    const r = await embed(app, sKlicem, { model: 'embed-v1', input: ['x'], cache_salt: 'najemce-b' });
    expect([r.json().duvod, r.json().pole]).toEqual(['POLE_PLATFORMY', 'cache_salt']);
    expect(engine.pozadavky).toEqual([]);
  });
  it('jméno modelu s prostorem jmen (alfa/…) = POLE_PLATFORMY (V3)', async () => {
    const { app } = sestav();
    expect((await embed(app, sKlicem, { model: 'alfa/embed-v1', input: ['x'] })).json().duvod).toBe('POLE_PLATFORMY');
  });
  // Fáze 1 nemá v deklaraci adaptéry, takže adaptér přijde jen parametrem nebo jménem
  // s prostorem jmen — obojí je pole platformy. Kód ADAPTER_NEPRIJAT přibude s fází 2
  // spolu s větví, která ho vydá (alias adaptéru na endpointu embedderu).
  it('embedder s adaptérem (lora_request) = odmítnuto POLE_PLATFORMY, nikdy tiše ignorováno (EM1)', async () => {
    const { app } = sestav();
    const r = await embed(app, sKlicem, { model: 'embed-v1', input: ['x'], lora_request: { lora_name: 'alfa-a', lora_path: '/adaptery/alfa-a' } });
    expect([r.statusCode, r.json().duvod, r.json().pole]).toEqual([400, 'POLE_PLATFORMY', 'lora_request']);
    expect(JSON.stringify(r.json())).not.toContain('/adaptery');
    expect(engine.pozadavky).toEqual([]);
  });
  it('neznámé pole, chybějící třída, nečitelné tělo = POZADAVEK_NEPLATNY', async () => {
    const { app } = sestav();
    expect((await embed(app, sKlicem, { model: 'embed-v1', input: ['x'], extra: 1 })).json().duvod).toBe('POZADAVEK_NEPLATNY');
    const bezTridy = await app.inject({ method: 'POST', url: '/v1/embeddings', headers: { ...sKlicem, 'content-type': 'application/json' }, payload: JSON.stringify({ model: 'embed-v1', input: ['x'] }) });
    expect(bezTridy.json().duvod).toBe('POZADAVEK_NEPLATNY');
    const rozbite = await app.inject({ method: 'POST', url: '/v1/embeddings', headers: { ...sKlicem, 'x-aisha-trida': 'dotaz', 'content-type': 'application/json' }, payload: '{nejson' });
    expect(rozbite.json().duvod).toBe('POZADAVEK_NEPLATNY');
    expect(engine.pozadavky).toEqual([]);
  });
});

describe('modely (V1, V2) a cesty (I6, MJ16)', () => {
  const sKlicem = { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` };
  it('/v1/models = jen aliasy nájemce z deklarace, engine se neptá (V1, MJ21)', async () => {
    const { app } = sestav();
    const r = await app.inject({ method: 'GET', url: '/v1/models', headers: sKlicem });
    expect(r.json()).toEqual({ object: 'list', data: [{ id: 'embed-v1', object: 'model', owned_by: 'aisha' }] });
    expect(engine.pozadavky).toEqual([]);
  });
  it('alias, který nájemce nemá = 404 MODEL_NENALEZEN (V2)', async () => {
    const { app } = sestav();
    expect((await embed(app, sKlicem, { model: 'chat-v1', input: ['x'] })).json().duvod).toBe('MODEL_NENALEZEN');
  });
  it('cesta mimo seznam (i /v1/load_lora_adapter) = 404 CESTA_NEZNAMA i s platným klíčem (I6, MJ16)', async () => {
    const { app } = sestav();
    // /v1/chat/completions je od chat lane deklarovaná cesta (chat.test.ts); správa adaptérů a enginu dál ne.
    for (const url of ['/v1/load_lora_adapter', '/v1/unload_lora_adapter', '/v1/completions', '/metrics', '/health']) {
      const r = await app.inject({ method: 'POST', url, headers: { ...sKlicem, 'content-type': 'application/json' }, payload: '{}' });
      expect([url, r.statusCode, r.json().duvod]).toEqual([url, 404, 'CESTA_NEZNAMA']);
    }
    expect(engine.pozadavky).toEqual([]);
  });
});

describe('připravenost (R5a) a engine', () => {
  const sKlicem = { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` };
  it('lane startuje / nedostupná = 503 s kódem HNED, bez volání enginu', async () => {
    for (const kod of ['LANE_STARTUJE', 'LANE_NEDOSTUPNA']) {
      const { app } = sestav({ r5: () => kod as Duvod });
      const t0 = Date.now();
      const r = await embed(app, sKlicem);
      expect([r.statusCode, r.json().duvod]).toEqual([503, kod]);
      expect(Date.now() - t0).toBeLessThan(500);
    }
    expect(engine.pozadavky).toEqual([]);
  });
  it('engine odmítne tvar (400) = ENGINE_ODMITL bez ozvěny obsahu enginu (E3)', async () => {
    const { app } = sestav();
    engine.status = 400;
    const r = await embed(app, sKlicem);
    expect([r.statusCode, r.json().duvod]).toEqual([400, 'ENGINE_ODMITL']);
    expect(r.body).not.toContain('TAJNY-OBSAH-ENGINU');
  });
});

describe('max_tokenu aliasu (obsah bez speciálních tokenů)', () => {
  const sLimitem = (limit: number) => {
    const u = uzel((x) => {
      for (const e of Object.values(x.enginy)) e.url = fakeUrl;
      x.najemci.z.modely['embed-v1'].max_tokenu = limit;
    });
    const r = postavTabulku(u);
    if ('vady' in r) throw new Error(r.vady.join('\n'));
    return sestav({ tabulka: () => r.tabulka }).app;
  };
  const z = { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` };
  it('krátký vstup projde bez měření; delší se změří tokenizérem enginu a nad limit = 400 POZADAVEK_NEPLATNY bez dotazu na embeddings', async () => {
    const app = sLimitem(10);
    const ok = await embed(app, z, { model: 'embed-v1', input: ['ahoj'] });
    expect(ok.statusCode).toBe(200);
    expect(engine.pozadavky.map((p) => p.cesta)).toEqual(['/tokenize', '/v1/embeddings']);
    engine.pozadavky = [];
    const dlouhy = await embed(app, z, { model: 'embed-v1', input: ['ahoj', 'x'.repeat(11)] });
    expect([dlouhy.statusCode, dlouhy.json().duvod, dlouhy.json().pole]).toEqual([400, 'POZADAVEK_NEPLATNY', 'input']);
    expect(engine.pozadavky.map((p) => p.cesta), 'embeddings se nevolá').toEqual(['/tokenize', '/tokenize']);
  });
  it('vstup do (max_tokenu − 1) / 6 bajtů se neměří (rychlá cesta)', async () => {
    const app = sLimitem(8192);
    expect((await embed(app, z, { model: 'embed-v1', input: ['ž'.repeat(682)] })).statusCode).toBe(200);
    expect(engine.pozadavky.map((p) => p.cesta)).toEqual(['/v1/embeddings']);
  });
});

describe('kvóty (Q2, Q3, R3, MJ19)', () => {
  it('souběh dotazů nájemce vyčerpán = 429 jen jemu; dávka má vlastní sloty (MN11); druhý nájemce běží (Q3)', async () => {
    const { app } = sestav();
    engine.zpozdeni_ms = 300;
    const z = { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` };
    const bezi = [embed(app, z), embed(app, z)];
    await new Promise((r) => setTimeout(r, 50));
    const treti = await embed(app, z);
    expect([treti.statusCode, treti.json().duvod, treti.json().kvota]).toEqual([429, 'KVOTA_PREKROCENA', 'soubeh.dotaz']);
    expect(treti.headers['retry-after'], 'plný souběh: zkusit znovu za 1 s').toBe('1');
    const davka = await embed(app, { ...z, 'x-aisha-trida': 'davka' });
    expect(davka.statusCode, 'dávka nesdílí sloty dotazů').toBe(200);
    const alfa = await embed(app, { ...ZA_ALFA, authorization: `Bearer ${KLIC_ALFA}` });
    expect(alfa.statusCode, 'kvóta Z nedopadá na ALFA').toBe(200);
    expect((await Promise.all(bezi)).map((r) => r.statusCode)).toEqual([200, 200]);
  });
  it('vyčerpané okno gpu_ms = 429 s Retry-After do hranice pevného okna (nahoru, aspoň 1 s); souběh = 1 s', () => {
    let ted = 120_000 + 45_300; // 45,3 s do okna 60 s
    const kvoty = new Kvoty(knihaVPameti(), () => ted);
    const n = { id: 'z', kvoty: { rezim: 'vynucovat', okno_s: 60, gpu_ms_za_okno: 100, soubeh: { dotaz: 1, davka: 1 }, davka_max_vstupu: 1 } } as unknown as Parameters<Kvoty['vstup']>[0];
    const prvni = kvoty.vstup(n, 'davka');
    if (!('uvolni' in prvni)) throw new Error('první požadavek má projít');
    expect(kvoty.vstup(n, 'davka')).toEqual({ duvod: 'KVOTA_PREKROCENA', kvota: 'soubeh.davka', znovuZaS: 1 });
    prvni.uvolni(150);
    expect(kvoty.vstup(n, 'davka')).toEqual({ duvod: 'KVOTA_PREKROCENA', kvota: 'gpu_ms_za_okno', znovuZaS: 15 });
    ted = 120_000 + 59_999;
    expect(kvoty.vstup(n, 'davka')).toMatchObject({ znovuZaS: 1 });
    ted = 180_000;
    expect('uvolni' in kvoty.vstup(n, 'davka'), 'nové okno pustí').toBe(true);
  });
  describe('režim varovani (deklarace kvoty.rezim): nad mez projde, varování v záznamu i v x-aisha-kvota', () => {
    const varovaniZ = (x: Parameters<Parameters<typeof uzel>[0]>[0]) => {
      x.najemci.z.kvoty = { ...x.najemci.z.kvoty!, rezim: 'varovani' };
    };
    it('souběh nad mez = 200 s hlavičkou a záznamem; počítá se dál (varování neschová, kde se nájemci potkávají)', async () => {
      const { app, zaznamy } = sestav({ uprav: varovaniZ });
      engine.zpozdeni_ms = 300;
      const z = { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` };
      const bezi = [embed(app, z), embed(app, z)];
      await new Promise((r) => setTimeout(r, 50));
      const treti = await embed(app, z);
      expect([treti.statusCode, treti.headers['x-aisha-kvota']], treti.body).toEqual([200, 'soubeh.dotaz']);
      expect(treti.headers['retry-after'], 'prošel — žádné Retry-After').toBeUndefined();
      expect(zaznamy).toContainEqual(['kvota_varovani', expect.objectContaining({ najemce: 'z', kvoty: ['soubeh.dotaz'], trida: 'dotaz' })]);
      const r = await Promise.all(bezi);
      expect(r.map((x) => [x.statusCode, x.headers['x-aisha-kvota']]), 'pod mezí bez hlavičky').toEqual([[200, undefined], [200, undefined]]);
    });
    it('víc vstupů než davka_max_vstupu: varovani projde k enginu celé, vynucovat = 429 bez dotazu na engine', async () => {
      const telo = { model: 'embed-v1', input: Array.from({ length: 40 }, (_, i) => `v${i}`) };
      const z = { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` };
      const mekky = await embed(sestav({ uprav: varovaniZ }).app, z, telo);
      expect([mekky.statusCode, mekky.headers['x-aisha-kvota']], mekky.body).toEqual([200, 'davka_max_vstupu']);
      expect((engine.pozadavky.at(-1)?.telo as { input: string[] }).input).toHaveLength(40);
      engine.pozadavky = [];
      const tvrdy = await embed(sestav().app, z, telo);
      expect([tvrdy.statusCode, tvrdy.json().duvod, tvrdy.json().kvota]).toEqual([429, 'KVOTA_PREKROCENA', 'davka_max_vstupu']);
      expect(engine.pozadavky).toEqual([]);
    });
    it('vyčerpané okno gpu_ms: varovani pustí s výčtem, vynucovat odmítne (táž kniha, táž čísla)', () => {
      const kvoty = new Kvoty(knihaVPameti(), () => 120_000);
      const najemce = (rezim: 'varovani' | 'vynucovat') => ({ id: `z-${rezim}`, kvoty: { rezim, okno_s: 60, gpu_ms_za_okno: 100, soubeh: { dotaz: 5, davka: 5 }, davka_max_vstupu: 1 } }) as unknown as Parameters<Kvoty['vstup']>[0];
      for (const rezim of ['varovani', 'vynucovat'] as const) {
        const p = kvoty.vstup(najemce(rezim), 'davka');
        if (!('uvolni' in p)) throw new Error('první požadavek má projít');
        expect(p.prekroceno).toEqual([]);
        p.uvolni(150);
      }
      const mekky = kvoty.vstup(najemce('varovani'), 'davka');
      expect('uvolni' in mekky && mekky.prekroceno).toEqual(['gpu_ms_za_okno']);
      expect(kvoty.vstup(najemce('vynucovat'), 'davka')).toMatchObject({ duvod: 'KVOTA_PREKROCENA', kvota: 'gpu_ms_za_okno' });
      expect(kvoty.agregat(najemce('varovani'))).toMatchObject({ rezim: 'varovani', gpu_ms: 150 });
    });
    it('kniha spotřeby nedostupná zůstává tvrdá i ve varovani (účetnictví, ne mez)', async () => {
      const { app } = sestav({ kniha: { ...knihaVPameti(), dostupna: () => false }, uprav: varovaniZ });
      const r = await embed(app, { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` });
      expect([r.statusCode, r.json().duvod]).toEqual([503, 'POCITADLO_NEDOSTUPNE']);
      expect(engine.pozadavky).toEqual([]);
    });
  });
  it('kniha spotřeby nedostupná = 503 POCITADLO_NEDOSTUPNE, nic neprojde nezapočtené (Q2, MJ19)', async () => {
    const kniha = { ...knihaVPameti(), dostupna: () => false };
    const { app } = sestav({ kniha });
    const r = await embed(app, { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` });
    expect([r.statusCode, r.json().duvod]).toEqual([503, 'POCITADLO_NEDOSTUPNE']);
    expect(engine.pozadavky).toEqual([]);
  });
  it('spotřeba se účtuje do knihy nájemce, ne jinému (Q1, D3)', async () => {
    const { app, kvoty, t } = sestav();
    engine.zpozdeni_ms = 120;
    expect((await embed(app, { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` })).statusCode).toBe(200);
    expect(kvoty.agregat(t.najemci.get('z')!).gpu_ms).toBeGreaterThanOrEqual(100);
    expect(kvoty.agregat(t.najemci.get('alfa')!).gpu_ms).toBe(0);
  });
});

describe('přerušení klientem se účtuje (Q5, MJ12) — skutečný socket', () => {
  it('klient odejde po 200 ms z 1 s: engine přerušen, spotřeba > 0', async () => {
    const { app, kvoty, t } = sestav();
    engine.zpozdeni_ms = 1000;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    await request(`http://127.0.0.1:${port}/v1/embeddings`, {
      method: 'POST',
      headers: { ...ZA_Z, authorization: `Bearer ${KLIC_Z}`, 'x-aisha-trida': 'dotaz', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'embed-v1', input: ['x'] }),
      signal: ac.signal,
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    expect(engine.preruseno, 'engine nedostal přerušení').toBe(1);
    expect(kvoty.agregat(t.najemci.get('z')!).gpu_ms).toBeGreaterThanOrEqual(150);
    await app.close();
  });
});

describe('výchozí adresy jsou ze socketu (žádný test-seam v provozu)', () => {
  it('bez `adresy` vstup nezná 127.0.0.1 → VSTUP_NEZNAMY (hlavičky x-test-* se v provozu nečtou)', async () => {
    const u = uzel((x) => {
    for (const e of Object.values(x.enginy)) e.url = fakeUrl;
  });
    const r0 = postavTabulku(u);
    if ('vady' in r0) throw new Error();
    const app = vytvorVstup({ tabulka: () => r0.tabulka, pripravenost: { rozhodni: () => null } as unknown as Pripravenost, clenstvi: () => clenstviOk(), kvoty: new Kvoty(knihaVPameti()), upstream });
    const r = await embed(app, { ...ZA_Z, authorization: `Bearer ${KLIC_Z}` });
    expect(r.json().duvod).toBe('VSTUP_NEZNAMY');
  });
});
