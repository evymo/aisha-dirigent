/**
 * Money agenda na „bad portu" WHATWG Fetch musí být dosažitelná.
 *
 * ⛔ Naměřeno 2026-09-15 v produkci instance: agendy na portech 87 a 95 hlásily
 * `fetch failed`, i když TCP spojení vedlo a `node:http` dostal token i faktury.
 * Node `fetch` (undici) porty ze seznamu „bad ports" vůbec neotevře.
 *
 * Porty 87/95 by test musel otevřít jako root; ze stejného seznamu se proto bere
 * port nad 1024 (6665–6669, 6697, 10080). Kontrolní vzorek: globální `fetch` na něm
 * MUSÍ selhat — jinak by test neměřil nic.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { httpFetcher, getToken, graphql, _resetTokenCache, type MoneyTarget } from '../lib/money.js';

const BAD_PORTS = [6666, 6667, 6668, 6669, 6665, 6697, 10080];
let server: Server;
let port = 0;
const prijate: Array<{ path: string; body: string; ct: string | undefined }> = [];

function listenOn(p: number): Promise<boolean> {
  return new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(p, '127.0.0.1', () => resolve(true));
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      prijate.push({ path: req.url ?? '', body, ct: req.headers['content-type'] });
      if (req.url === '/nikdy') return; // neodpoví — pro timeout
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/connect/token') { res.end(JSON.stringify({ access_token: 'tok', expires_in: 3599 })); return; }
      if (req.url === '/graphql') { res.end(JSON.stringify({ Data: { IssuedInvoices: [{ CisloDokladu: 'FV1' }] } })); return; }
      res.statusCode = 404; res.end('{}');
    });
  });
  for (const p of BAD_PORTS) {
    if (await listenOn(p)) { port = (server.address() as AddressInfo).port; break; }
  }
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { _resetTokenCache(); prijate.length = 0; });

describe('bad port WHATWG Fetch', () => {
  it('měřidlo: port je ze seznamu bad ports a globální fetch na něj NEJDE', async () => {
    expect(BAD_PORTS).toContain(port);
    await expect(fetch(`http://127.0.0.1:${port}/connect/token`)).rejects.toThrow();
  });

  it('httpFetcher na témž portu projde a pošle tělo i hlavičky', async () => {
    const r = await httpFetcher(`http://127.0.0.1:${port}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'x' }),
    });
    expect(r.ok).toBe(true);
    expect(await r.json()).toMatchObject({ access_token: 'tok' });
    expect(prijate[0]).toMatchObject({ path: '/connect/token', body: 'grant_type=client_credentials&client_id=x', ct: 'application/x-www-form-urlencoded' });
  });

  it('token i GraphQL agendy na bad portu jdou přes výchozí vrstvu (bez podstrčeného fetch)', async () => {
    const t: MoneyTarget = { key: 'MN', label: 'agenda na bad portu', host: '127.0.0.1', port, clientId: 'c', clientSecret: 's' };
    expect(await getToken(t)).toBe('tok');
    const r = await graphql(t, '{ IssuedInvoices(From:0, Count:1) { CisloDokladu } }');
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({ IssuedInvoices: [{ CisloDokladu: 'FV1' }] });
  });

  it('neodpovídající server se ukončí časovým limitem, nevisí', async () => {
    const t = Date.now();
    await expect(httpFetcher(`http://127.0.0.1:${port}/nikdy`, { method: 'POST', body: 'x', signal: AbortSignal.timeout(300) })).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(3_000);
  });

  it('chybový status se propustí jako ok:false s textem', async () => {
    const r = await httpFetcher(`http://127.0.0.1:${port}/neexistuje`);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });
});
