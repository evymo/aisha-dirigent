// Zahřátí chatového enginu (generate): identita vah ze souboru v adresáři, který engine sám hlásí,
// a jednotokenová odpověď. Adaptéry řeší dorovnání (adaptery.test.ts), ne zahřátí.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vytvorSondy } from '../enginy.js';
import type { Engine } from '../tabulka.js';

const ZAKLAD = '/vahy/org--chat@' + 'b'.repeat(40);
const LENS = '/vahy/org--lens@' + 'e'.repeat(40);
const ID_ZAKLAD = { format: 'safetensors', sha256: 'a'.repeat(64), revize: 'b'.repeat(40) };
const ID_LENS = { format: 'safetensors', sha256: 'c'.repeat(64), revize: 'e'.repeat(40) };
const stav = { modely: [] as Array<{ id: string; root: string }>, chatStatus: 200, chaty: [] as unknown[] };
let srv: Server;
let url = '';
beforeAll(async () => {
  srv = createServer((req, res) => {
    let t = '';
    req.on('data', (c) => (t += c));
    req.on('end', () => {
      if (req.url === '/v1/models') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: stav.modely }));
      if (req.url === '/v1/chat/completions') {
        stav.chaty.push(JSON.parse(t));
        if (stav.chatStatus !== 200) return res.writeHead(stav.chatStatus).end('{}');
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'x' } }] }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));
beforeEach(() => {
  stav.modely = [{ id: 'chat-1', root: ZAKLAD }, { id: 'z.lens', root: LENS }];
  stav.chatStatus = 200;
  stav.chaty = [];
});

const soubory: Record<string, unknown> = { [`${ZAKLAD}/aisha-identita.json`]: ID_ZAKLAD, [`${LENS}/aisha-identita.json`]: ID_LENS };
const sondy = () => vytvorSondy({ ctiSoubor: async (c) => JSON.stringify(soubory[c] ?? (() => { throw new Error(`ENOENT ${c}`); })()) });
const chat = (adaptery: Engine['adaptery'] = { 'z.lens': { sha256: ID_LENS.sha256, revize: ID_LENS.revize, adresar: LENS } }): Engine => ({
  id: 'chat-1', druh: 'generate', url, zapnuto: true, start_mez_s: 900, identita: ID_ZAKLAD, model: 'chat-1', zahrati_tokenu: 1, recept: 'chat', adaptery,
});

describe('zahřátí chatového enginu', () => {
  it('identita základu i adaptéru sedí → připraven; jedna odpověď s max_tokens 1 na základ', async () => {
    expect(await sondy().zahrej(chat())).toEqual(ID_ZAKLAD);
    expect(stav.chaty).toEqual([{ model: 'chat-1', messages: [{ role: 'user', content: 'lane' }], max_tokens: 1 }]);
  });
  it('zahřátí adaptéry neřeší: deklarovaný adaptér, který engine (zatím) nenačetl, zahřátí neshodí — načte ho dorovnání', async () => {
    stav.modely = [{ id: 'chat-1', root: ZAKLAD }];
    expect(await sondy().zahrej(chat())).toEqual(ID_ZAKLAD);
  });
  it('základ mimo /vahy/<repo>@<revize> = zahřátí selže, soubor se nečte', async () => {
    stav.modely = [{ id: 'chat-1', root: '/tmp/chat' }];
    await expect(sondy().zahrej(chat())).rejects.toThrow(/mimo \/vahy/);
  });
  it('odpověď enginu ≠ 200 = zahřátí selže (nikdy připraven)', async () => {
    stav.chatStatus = 500;
    await expect(sondy().zahrej(chat())).rejects.toThrow(/zahřívací odpověď neprošla/);
  });
});
