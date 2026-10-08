// Chat lane (/v1/chat/completions) proti falešnému enginu generate: alias → adaptér nájemce,
// sůl cache a strop tokenů dosazuje vstup, pole platformy se odmítnou, proud SSE se přepíše
// na alias a gpu_ms se účtuje do posledního bajtu.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { request } from 'undici';
import type { FastifyInstance } from 'fastify';
import { Kvoty, knihaVPameti } from '../kvoty.js';
import type { Pripravenost } from '../pripravenost.js';
import { prepisProudu, solNajemce, vytvorVstup, type Upstream } from '../vstup.js';
import { postavTabulku, type Engine } from '../tabulka.js';
import { IP_Z, KLIC_Z, clenstviOk, uzel, type UzelFix } from './fixtura.js';

const SHA_A = 'c'.repeat(64);
const REV_A = 'e'.repeat(40);
const engine = { pozadavky: [] as Array<{ cesta: string; telo: Record<string, unknown> }>, status: 200 };
let fake: Server;
let fakeUrl = '';

beforeAll(async () => {
  fake = createServer((req, res) => {
    let kusy = '';
    req.on('data', (c) => (kusy += c));
    req.on('end', () => {
      const telo = kusy ? (JSON.parse(kusy) as Record<string, unknown>) : {};
      engine.pozadavky.push({ cesta: req.url ?? '', telo });
      if (engine.status !== 200) {
        res.writeHead(engine.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'TAJNY-OBSAH-ENGINU' }));
      }
      if (telo.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        // Událost rozdělená přes dva kusy proudu: přepis ji musí složit.
        const u1 = `data: ${JSON.stringify({ id: 'x', model: telo.model, choices: [{ delta: { content: 'Ahoj' } }] })}\n\n`;
        const u2 = `data: ${JSON.stringify({ id: 'x', model: telo.model, choices: [{ delta: { content: ' světe' } }] })}\n\n`;
        res.write(u1 + u2.slice(0, 20));
        setTimeout(() => {
          res.write(u2.slice(20));
          res.end('data: [DONE]\n\n');
        }, 30);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', object: 'chat.completion', model: telo.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Ahoj' } }] }));
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => fake.close(() => r())));
beforeEach(() => {
  engine.pozadavky = [];
  engine.status = 200;
});

const upstream: Upstream = {
  async post(e: Engine, cesta, telo, signal) {
    const r = await request(`${e.url}${cesta}`, { method: 'POST', body: JSON.stringify(telo), headers: { 'content-type': 'application/json' }, signal });
    return { status: r.statusCode, telo: await r.body.json() };
  },
  async proud(e: Engine, cesta, telo, signal) {
    const r = await request(`${e.url}${cesta}`, { method: 'POST', body: JSON.stringify(telo), headers: { 'content-type': 'application/json' }, signal });
    return { status: r.statusCode, proud: r.body };
  },
};

/** Uzel s chatovým enginem `chat-1` (adaptér nájemce z) a aliasy z: lens (adaptér), zaklad (bez adaptéru). */
function sChatem(uprav: (u: UzelFix) => void = () => {}) {
  return uzel((x) => {
    for (const e of Object.values(x.enginy)) e.url = fakeUrl;
    x.enginy['chat-1'] = {
      druh: 'generate', url: fakeUrl, zapnuto: true, start_mez_s: 600,
      identita: { format: 'safetensors', sha256: 'a'.repeat(64), revize: 'b'.repeat(40) },
      model: 'chat-1', zahrati_tokenu: 1, recept: 'chat=bf16',
      adaptery: { 'z.lens': { sha256: SHA_A, revize: REV_A, adresar: `/vahy/org--lens@${REV_A}` } },
    };
    x.najemci.z.modely = { ...x.najemci.z.modely, lens: { engine: 'chat-1', max_tokenu: 256, adapter: 'z.lens' }, zaklad: { engine: 'chat-1', max_tokenu: 64 } };
    uprav(x);
  });
}
function sestav(u = sChatem(), nactene: (e: Engine, j: string) => boolean = () => true) {
  const r = postavTabulku(u);
  if ('vady' in r) throw new Error(r.vady.join('\n'));
  const zaznamy: Array<[string, Record<string, unknown>]> = [];
  const kvoty = new Kvoty(knihaVPameti());
  const app = vytvorVstup({
    tabulka: () => r.tabulka,
    pripravenost: { rozhodni: () => null } as unknown as Pripravenost,
    clenstvi: () => clenstviOk(),
    kvoty,
    upstream,
    adresy: (req) => ({ lokalni: String(req.headers['x-test-lokalni'] ?? ''), vzdalena: String(req.headers['x-test-vzdalena'] ?? '') }),
    zaznam: (u2, d) => zaznamy.push([u2, d]),
    adaptery: { jeNacteny: nactene },
  });
  return { app, kvoty, t: r.tabulka, zaznamy };
}
const Z = { 'x-test-lokalni': IP_Z.vstup, 'x-test-vzdalena': IP_Z.klient, authorization: `Bearer ${KLIC_Z}`, 'x-aisha-trida': 'dotaz', 'content-type': 'application/json' };
const chat = (app: FastifyInstance, telo: unknown) => app.inject({ method: 'POST', url: '/v1/chat/completions', headers: Z, payload: JSON.stringify(telo) });
const ZPRAVY = [{ role: 'user', content: 'Ahoj' }];

describe('chat: alias → adaptér, sůl a strop dosazuje vstup', () => {
  it('alias s adaptérem: engine dostane <nájemce>.<adaptér>, sůl nájemce a strop tokenů; odpověď nese alias a identitu', async () => {
    const { app } = sestav();
    const r = await chat(app, { model: 'lens', messages: ZPRAVY });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().model).toBe('lens');
    expect(r.headers['x-aisha-identita']).toBe(`safetensors:${'a'.repeat(64)}`);
    expect(engine.pozadavky.at(-1)).toEqual({ cesta: '/v1/chat/completions', telo: { model: 'z.lens', messages: ZPRAVY, max_tokens: 256, cache_salt: solNajemce('z') } });
  });
  it('alias bez adaptéru jde na základ enginu; nižší max_tokens se ponechá', async () => {
    const { app } = sestav();
    expect((await chat(app, { model: 'zaklad', messages: ZPRAVY, max_tokens: 10 })).statusCode).toBe(200);
    expect(engine.pozadavky.at(-1)?.telo).toMatchObject({ model: 'chat-1', max_tokens: 10 });
  });
  it('pole platformy (cache_salt, lora_request) = POLE_PLATFORMY; neznámé pole, n≠1, obrázek, max_tokens nad strop = 400; nic k enginu', async () => {
    const { app } = sestav();
    const pripady: Array<[unknown, string, string | undefined]> = [
      [{ model: 'lens', messages: ZPRAVY, cache_salt: 'cizi' }, 'POLE_PLATFORMY', 'cache_salt'],
      [{ model: 'lens', messages: ZPRAVY, lora_request: { lora_name: 'jiny.lens' } }, 'POLE_PLATFORMY', 'lora_request'],
      [{ model: 'alfa/lens', messages: ZPRAVY }, 'POLE_PLATFORMY', 'model'],
      [{ model: 'lens', messages: ZPRAVY, tools: [] }, 'POZADAVEK_NEPLATNY', undefined],
      [{ model: 'lens', messages: ZPRAVY, n: 2 }, 'POZADAVEK_NEPLATNY', 'n'],
      [{ model: 'lens', messages: [{ role: 'user', content: [{ type: 'image_url' }] }] }, 'POZADAVEK_NEPLATNY', 'messages'],
      [{ model: 'lens', messages: ZPRAVY, max_tokens: 257 }, 'POZADAVEK_NEPLATNY', 'max_tokens'],
    ];
    for (const [telo, duvod, pole] of pripady) {
      const r = await chat(app, telo);
      expect([r.statusCode >= 400, r.json().duvod, r.json().pole], JSON.stringify(telo)).toEqual([true, duvod, pole]);
    }
    expect(engine.pozadavky).toEqual([]);
  });
  it('embedder chatem a chat embeddingy = MODEL_NENALEZEN (druh enginu rozhoduje)', async () => {
    const { app } = sestav();
    expect((await chat(app, { model: 'embed-v1', messages: ZPRAVY })).json().duvod).toBe('MODEL_NENALEZEN');
    const e = await app.inject({ method: 'POST', url: '/v1/embeddings', headers: Z, payload: JSON.stringify({ model: 'lens', input: ['x'] }) });
    expect(e.json().duvod).toBe('MODEL_NENALEZEN');
  });
  it('engine odmítne (400) = ENGINE_ODMITL bez ozvěny obsahu enginu', async () => {
    const { app } = sestav();
    engine.status = 400;
    const r = await chat(app, { model: 'lens', messages: ZPRAVY });
    expect([r.statusCode, r.json().duvod]).toEqual([400, 'ENGINE_ODMITL']);
    expect(r.body).not.toContain('TAJNY-OBSAH-ENGINU');
  });
  it('⛔ adaptér neověřený / nenačtený dorovnáním = 503 LANE_STARTUJE, nic k enginu; základ bez adaptéru jde', async () => {
    const { app } = sestav(sChatem(), () => false);
    const r = await chat(app, { model: 'lens', messages: ZPRAVY });
    expect([r.statusCode, r.json().duvod]).toEqual([503, 'LANE_STARTUJE']);
    expect(engine.pozadavky).toEqual([]);
    expect((await chat(app, { model: 'zaklad', messages: ZPRAVY })).statusCode, 'základ adaptér nepotřebuje').toBe(200);
  });
  it('⛔ nájemce s platným klíčem na načítání adaptérů nedosáhne (CESTA_NEZNAMA), engine nic nedostane', async () => {
    const { app } = sestav();
    for (const url of ['/v1/load_lora_adapter', '/v1/unload_lora_adapter']) {
      const r = await app.inject({ method: 'POST', url, headers: Z, payload: JSON.stringify({ lora_name: 'z.lens', lora_path: '/vahy/x' }) });
      expect([url, r.statusCode, r.json().duvod]).toEqual([url, 404, 'CESTA_NEZNAMA']);
    }
    expect(engine.pozadavky).toEqual([]);
  });
  it('/v1/models nájemce ukazuje jeho aliasy, ne adaptéry ani enginy', async () => {
    const { app } = sestav();
    const r = await app.inject({ method: 'GET', url: '/v1/models', headers: Z });
    expect(r.json().data.map((x: { id: string }) => x.id)).toEqual(['embed-v1', 'lens', 'zaklad']);
  });
});

describe('chat: proud SSE', () => {
  it('model se v každé události přepíše na alias (i přes hranici kusů), [DONE] projde, gpu_ms do posledního bajtu', async () => {
    const { app, kvoty, t, zaznamy } = sestav();
    const r = await chat(app, { model: 'lens', messages: ZPRAVY, stream: true });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/event-stream/);
    const udalosti = r.body.split('\n').filter((x) => x.startsWith('data: '));
    expect(udalosti.at(-1)).toBe('data: [DONE]');
    const json = udalosti.slice(0, -1).map((x) => JSON.parse(x.slice(6)) as { model: string; choices: Array<{ delta: { content: string } }> });
    expect(json.map((x) => x.model)).toEqual(['lens', 'lens']);
    expect(json.map((x) => x.choices[0].delta.content).join('')).toBe('Ahoj světe');
    expect(r.body).not.toContain('z.lens');
    expect(zaznamy.find(([u]) => u === 'proud_hotov')?.[1]).toMatchObject({ najemce: 'z', engine: 'chat-1' });
    expect(kvoty.agregat(t.najemci.get('z')!).gpu_ms, 'proud trval přes 30 ms enginu').toBeGreaterThanOrEqual(25);
  });
  it('⛔ chyba enginu před proudem: odmítnutí, ale slot souběhu se UVOLNÍ a čas enginu se započte (revize e0e4b04fd)', async () => {
    const { app, kvoty, t } = sestav();
    engine.status = 500;
    for (let i = 0; i < 3; i++) {
      const r = await chat(app, { model: 'lens', messages: ZPRAVY, stream: true });
      expect([r.statusCode, r.json().duvod]).toEqual([503, 'LANE_NEDOSTUPNA']);
    }
    expect(kvoty.agregat(t.najemci.get('z')!).bezi, 'souběh dotazů = 2: třetí by bez uvolnění dostal 429').toEqual({ dotaz: 0, davka: 0 });
    engine.status = 200;
    expect((await chat(app, { model: 'lens', messages: ZPRAVY, stream: true })).statusCode, 'slot je volný').toBe(200);
  });
  it('po proudu i po odpovědi vcelku je souběh zpátky na nule', async () => {
    const { app, kvoty, t } = sestav();
    await chat(app, { model: 'lens', messages: ZPRAVY, stream: true });
    await chat(app, { model: 'lens', messages: ZPRAVY });
    expect(kvoty.agregat(t.najemci.get('z')!).bezi).toEqual({ dotaz: 0, davka: 0 });
  });
  it('prepisProudu: nečitelný řádek projde beze změny, chybějící model se nepřidá', async () => {
    async function* z() {
      yield 'data: {"a":1}\n';
      yield ': komentář\ndata: neni-json\n';
    }
    const ven: string[] = [];
    for await (const k of prepisProudu(z(), 'alias')) ven.push(k);
    expect(ven.join('')).toBe('data: {"a":1}\n: komentář\ndata: neni-json\n');
  });
});

describe('tabulka: adaptéry', () => {
  const vady = (u: UzelFix) => {
    const r = postavTabulku(u);
    return 'vady' in r ? r.vady.join('\n') : '';
  };
  it('kotva: platný chat s adaptérem nájemce projde', () => {
    expect(vady(sChatem())).toBe('');
  });
  it('adaptér cizího nájemce, adaptér, který engine nedeklaruje, a adaptér u embedderu = vada', () => {
    expect(vady(sChatem((x) => { x.enginy['chat-1'].adaptery = { 'alfa.lens': { sha256: SHA_A, revize: REV_A, adresar: `/vahy/org--lens@${REV_A}` } }; x.najemci.z.modely.lens = { engine: 'chat-1', max_tokenu: 1, adapter: 'alfa.lens' }; }))).toMatch(/není v prostoru jmen nájemce/);
    expect(vady(sChatem((x) => { x.najemci.z.modely.lens = { engine: 'chat-1', max_tokenu: 1, adapter: 'z.jiny' }; }))).toMatch(/nedeklaruje/);
    expect(vady(sChatem((x) => { x.enginy['chat-1'].adaptery!['z.lens'].adresar = `/vahy/org--lens@${'d'.repeat(40)}`; }))).toMatch(/nenese revizi/);
    expect(vady(sChatem((x) => { x.najemci.z.modely['embed-v1'] = { engine: 'embed-1', max_tokenu: 1, adapter: 'z.lens' }; }))).toMatch(/jen u enginu generate/);
  });
});
