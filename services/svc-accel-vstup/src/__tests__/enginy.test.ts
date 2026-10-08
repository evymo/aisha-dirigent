// Sondy VB → engine: zdraví, zahřátí na plnou délku a identita vah ze souboru změřeného
// při stažení (EM2) — ne z deklarace ani z hlášení enginu (MJ9). Falešný engine počítá tokeny
// jako bge-m3 ve vLLM 0.30 (změřeno na GPU uzlu 10-05): slovo = `naSlovo` tokenů, +2 speciální,
// `max_model_len` je VČETNĚ speciálních a delší vstup = HTTP 400 (žádný tichý ořez).
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { textNaTokeny, vytvorSondy, vytvorUpstream } from '../enginy.js';
import type { Engine } from '../tabulka.js';
import { uzel } from './fixtura.js';

const stav = { zdravy: true, root: '/vahy/bge@' + 'b'.repeat(40), vstupTokenu: 0, embedding: [0.1, 0.2] as number[], naSlovo: 2, maxModelLen: 8192, tokenize: true, hlasiTokenu: null as number | null };
const tokenu = (text: string) => text.split(' ').filter(Boolean).length * stav.naSlovo + 2;
let srv: Server;
let url = '';
beforeAll(async () => {
  srv = createServer((req, res) => {
    let t = '';
    req.on('data', (c) => (t += c));
    req.on('end', () => {
      if (req.url === '/health') return res.writeHead(stav.zdravy ? 200 : 503).end();
      if (req.url === '/v1/models') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'embed-1', root: stav.root }, { id: 'cizi-adapter', root: '/jinde' }] }));
      if (req.url === '/tokenize' && stav.tokenize) {
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ count: tokenu(JSON.parse(t).prompt), max_model_len: stav.maxModelLen }));
      }
      if (req.url === '/v1/embeddings') {
        const n = tokenu(JSON.parse(t).input[0]);
        if (n > stav.maxModelLen) return res.writeHead(400, { 'content-type': 'application/json' }).end('{}');
        stav.vstupTokenu = n;
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ embedding: stav.embedding }], usage: { prompt_tokens: stav.hlasiTokenu ?? n } }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const e = (): Engine => ({ ...uzel().enginy['embed-1'], id: 'embed-1', url });
const IDENTITA = { format: 'safetensors', sha256: 'a'.repeat(64), revize: 'b'.repeat(40) };

describe('sondy enginu', () => {
  it('zdraví = /health 200; jinak false (i nedosažitelný engine)', async () => {
    const s = vytvorSondy();
    stav.zdravy = true;
    expect(await s.zdravi(e())).toBe(true);
    stav.zdravy = false;
    expect(await s.zdravi(e())).toBe(false);
    expect(await s.zdravi({ ...e(), url: 'http://127.0.0.1:1' })).toBe(false);
    stav.zdravy = true;
  });

  it('engine přijme spojení a mlčí (černá díra) → zdraví false do ~1 s, ne až po výchozích 10 s undici', async () => {
    const dira = createNetServer(() => {});
    await new Promise<void>((r) => dira.listen(0, '127.0.0.1', r));
    const t0 = performance.now();
    const ok = await vytvorSondy().zdravi({ ...e(), url: `http://127.0.0.1:${(dira.address() as AddressInfo).port}` });
    const ms = performance.now() - t0;
    dira.close();
    expect(ok).toBe(false);
    expect(ms).toBeLessThan(1500);
  });

  // 192.0.2.0/24 je dokumentační rozsah (RFC 5737): na SYN nikdo neodpoví, spojení visí
  // ve fázi navazování. Tu kryje jen mez DISPEČERA — volba požadavku `connectTimeout` by
  // tiše propadla na výchozích 10 s (síť bez trasy vrátí chybu hned; mez platí i tak).
  it('spojení se nenaváže (SYN bez odpovědi) → zdraví i přeposlání skončí do ~1 s', async () => {
    const nikde = { ...e(), url: 'http://192.0.2.1:9' };
    let t0 = performance.now();
    expect(await vytvorSondy().zdravi(nikde)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(1500);
    t0 = performance.now();
    await expect(vytvorUpstream().post(nikde, '/v1/embeddings', {}, new AbortController().signal)).rejects.toThrow();
    // Meze dispečera undici běží na hrubých časovačích (~500 ms): 1 s mez dopadne mezi 1,0 a 1,5 s.
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('zahřátí: identita ze souboru v adresáři, který engine hlásí; vstup na plnou délku (V6)', async () => {
    const cteno: string[] = [];
    const s = vytvorSondy({ ctiSoubor: async (c) => (cteno.push(c), JSON.stringify(IDENTITA)) });
    expect(await s.zahrej(e())).toEqual(IDENTITA);
    expect(cteno).toEqual([`${stav.root}/aisha-identita.json`]);
    expect(stav.vstupTokenu, 'přesně na max_model_len včetně speciálních').toBe(8192);
  });

  it('zahřátí odměřuje tokenizér enginu: jiný poměr tokenů na slovo pořád padne pod limit a co nejblíž k němu', async () => {
    const s = vytvorSondy({ ctiSoubor: async () => JSON.stringify(IDENTITA) });
    stav.naSlovo = 3;
    expect(await s.zahrej(e())).toEqual(IDENTITA);
    expect(stav.vstupTokenu).toBeLessThanOrEqual(8192);
    expect(stav.vstupTokenu).toBeGreaterThan(8192 - 3);
    stav.naSlovo = 2;
  });

  it('deklarace delší než max_model_len enginu, engine bez /tokenize, nebo jiný počet tokenů v odpovědi = zahřátí selže', async () => {
    const s = vytvorSondy({ ctiSoubor: async () => JSON.stringify(IDENTITA) });
    stav.maxModelLen = 4096;
    await expect(s.zahrej(e())).rejects.toThrow(/zahrati_tokenu 8192 > max_model_len 4096/);
    stav.maxModelLen = 8192;
    stav.tokenize = false;
    await expect(s.zahrej(e())).rejects.toThrow(/neodměří text zahřátí/);
    stav.tokenize = true;
    stav.hlasiTokenu = 512;
    await expect(s.zahrej(e())).rejects.toThrow(/zpracoval 512 tokenů/);
    stav.hlasiTokenu = null;
  });

  it('adresář bez změřené identity nebo prázdný vektor = zahřátí selže (nikdy připraveno)', async () => {
    const bezSouboru = vytvorSondy({ ctiSoubor: async () => { throw new Error('ENOENT'); } });
    await expect(bezSouboru.zahrej(e())).rejects.toThrow();
    stav.embedding = [];
    const s = vytvorSondy({ ctiSoubor: async () => JSON.stringify(IDENTITA) });
    await expect(s.zahrej(e())).rejects.toThrow(/zahřívací dotaz neprošel/);
    stav.embedding = [0.1];
  });

  it('engine nehlásí deklarovaný model = zahřátí selže', async () => {
    const s = vytvorSondy({ ctiSoubor: async () => JSON.stringify(IDENTITA) });
    await expect(s.zahrej({ ...e(), model: 'neni' })).rejects.toThrow(/nehlásí model 'neni'/);
  });

  it('adresář vah jen /vahy/<repo>@<revize>; identita jiné revize = zahřátí selže, soubor se mimo /vahy nečte', async () => {
    const ctene: string[] = [];
    const s = vytvorSondy({ ctiSoubor: async (c) => (ctene.push(c), JSON.stringify(IDENTITA)) });
    const puvodni = stav.root;
    for (const root of ['/clenstvi', '/vahy/../deklarace@' + 'b'.repeat(40), '/vahy/bge@' + 'b'.repeat(39), '/vahy/a/bge@' + 'b'.repeat(40)]) {
      stav.root = root;
      await expect(s.zahrej(e())).rejects.toThrow(/mimo \/vahy/);
    }
    expect(ctene).toEqual([]);
    stav.root = '/vahy/bge@' + 'c'.repeat(40);
    await expect(s.zahrej(e())).rejects.toThrow(/nepatří k adresáři/);
    stav.root = puvodni;
  });

  it('text zahřátí: jen syntetické slovo (žádná data nájemců), délka z tokenizéru', async () => {
    const tok = async (text: string) => ({ count: tokenu(text), maxModelLen: 8192 });
    const z = await textNaTokeny(tok, 100);
    expect([z.tokenu, new Set(z.text.split(' '))]).toEqual([100, new Set(['lane'])]);
  });
});
