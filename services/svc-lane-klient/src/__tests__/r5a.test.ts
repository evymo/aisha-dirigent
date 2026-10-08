// R5a z pohledu forku (RT5a, MJ13, MJ22, MN6, K1): skutečný klient na skutečném TCP proti
// falešnému vynucovacímu bodu. Stavy lane rozhoduje vstup (VB/pripravenost.test.ts);
// tady se měří, že klient odpoví do 3 s s kódem příčiny, nikam jinam nezkouší a klíč jen propustí.
import { createServer as tcpServer, connect, type Server as TcpServer } from 'node:net';
import { createServer as httpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { vytvorKlient, type Zavislosti } from '../klient.js';

const MEZ_R5A_MS = 3000;
const uklid: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (uklid.length) await uklid.pop()!();
});

async function poslouchej(s: HttpServer | TcpServer): Promise<number> {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  uklid.push(() => new Promise((r) => s.close(r)));
  return (s.address() as AddressInfo).port;
}

interface Prijaty {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  telo: string;
}

/** Falešný vstup: na /__vb/zije 204 (nebo `zije`), jinak `obsluha`. Počítá spojení a požadavky. */
async function falesnyVstup(obsluha: (req: IncomingMessage, res: ServerResponse, telo: string) => void, zije = 204) {
  const prijate: Prijaty[] = [];
  let spojeni = 0;
  const s = httpServer((req, res) => {
    let telo = '';
    req.on('data', (c) => (telo += c));
    req.on('end', () => {
      prijate.push({ method: req.method!, url: req.url!, headers: req.headers, telo });
      if (req.url === '/__vb/zije') {
        res.statusCode = zije;
        return res.end();
      }
      obsluha(req, res, telo);
    });
  });
  s.on('connection', () => spojeni++);
  const port = await poslouchej(s);
  return { url: `http://127.0.0.1:${port}`, prijate, spojeni: () => spojeni };
}

async function klient(upstream: string, navic: Partial<Zavislosti> = {}) {
  const app: FastifyInstance = vytvorKlient({ upstream, prijmout: () => true, ...navic });
  await app.listen({ host: '127.0.0.1', port: 0 });
  uklid.push(() => app.close());
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

async function dotaz(base: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const t0 = performance.now();
  const r = await fetch(`${base}/v1/embeddings`, {
    method: 'POST',
    ...init,
    headers: { 'content-type': 'application/json', 'x-aisha-trida': 'dotaz', ...init.headers },
    body: init.body ?? JSON.stringify({ model: 'e5', input: ['ahoj'] }),
  });
  const telo = await r.json().catch(() => null);
  return { status: r.status, telo, odmitl: r.headers.get('x-aisha-odmitl'), h: r.headers, ms: performance.now() - t0 };
}

const pockej = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('R5a — lane stojí: odpověď do 3 s s kódem příčiny, nikam jinam', () => {
  it('vstup odmítá spojení (zastavený) → LANE_NEDOSTUPNA od klienta, hned', async () => {
    const volny = tcpServer();
    const port = await poslouchej(volny);
    await new Promise((r) => volny.close(r));
    uklid.pop();
    const o = await dotaz(await klient(`http://127.0.0.1:${port}`));
    expect([o.status, o.telo?.duvod, o.odmitl]).toEqual([503, 'LANE_NEDOSTUPNA', 'klient']);
    expect(Object.keys(o.telo)[0], 'duvod je v těle první').toBe('duvod');
    expect(o.ms).toBeLessThan(MEZ_R5A_MS);
  });

  // Počítají se POŽADAVKY, ne spojení: undici po přerušení požadavku (abort) otevře jedno
  // nečinné spojení do zásoby (změřeno 10-05, undici 7.26; po zavření socketu serverem ne).
  // Opakování by byl druhý řádek požadavku — ten nesmí přijít (MJ13); „jinam“ hlídá test navnady.
  it('černá díra po přijetí → LANE_NEDOSTUPNA do 3 s, právě JEDEN požadavek (žádné opakování — MJ13, MJ22)', async () => {
    let pozadavku = 0;
    const dira = tcpServer((s) => {
      s.on('data', (d) => (pozadavku += String(d).match(/^[A-Z]+ \S+ HTTP\/1\.1\r$/gm)?.length ?? 0));
      uklid.push(async () => s.destroy());
    });
    const port = await poslouchej(dira);
    const o = await dotaz(await klient(`http://127.0.0.1:${port}`));
    expect([o.status, o.telo?.duvod, o.odmitl]).toEqual([503, 'LANE_NEDOSTUPNA', 'klient']);
    expect(o.ms).toBeGreaterThanOrEqual(900);
    expect(o.ms).toBeLessThan(MEZ_R5A_MS);
    await pockej(300);
    expect(pozadavku).toBe(1);
  });

  it('vstup hlásí LANE_STARTUJE → propuštěno beze změny (kód, kdo odmítl), do 3 s', async () => {
    const vb = await falesnyVstup((_q, res) => {
      res.writeHead(503, { 'content-type': 'application/json', 'x-aisha-odmitl': 'vstup' });
      res.end(JSON.stringify({ duvod: 'LANE_STARTUJE', error: 'lane startuje nebo se zahřívá' }));
    });
    const o = await dotaz(await klient(vb.url));
    expect([o.status, o.telo?.duvod, o.odmitl]).toEqual([503, 'LANE_STARTUJE', 'vstup']);
    expect(o.ms).toBeLessThan(MEZ_R5A_MS);
  });

  it('na adrese odpovídá něco, co není vstup (preflight ≠ 204) → LANE_NEDOSTUPNA a požadavek se NEPŘEPOŠLE', async () => {
    const cizi = await falesnyVstup((_q, res) => res.end('{}'), 200);
    const o = await dotaz(await klient(cizi.url));
    expect([o.status, o.telo?.duvod, o.odmitl]).toEqual([503, 'LANE_NEDOSTUPNA', 'klient']);
    expect(cizi.prijate.map((p) => p.url)).toEqual(['/__vb/zije']);
  });

  it('vstup přijal, ale neodpoví v mezi třídy → LANE_NEDOSTUPNA od klienta (ne visení do timeoutu dispatch)', async () => {
    const vb = await falesnyVstup(() => {});
    const o = await dotaz(await klient(vb.url, { limity: { dotaz: 300 } }));
    expect([o.status, o.telo?.duvod, o.odmitl]).toEqual([503, 'LANE_NEDOSTUPNA', 'klient']);
    expect(o.ms).toBeLessThan(MEZ_R5A_MS);
  });
});

describe('připraveno: klient je průhledný', () => {
  it('kotva: stav, tělo a hlavičky identity propuštěny; Authorization dorazí přesně tak, jak přišla; nic nepřidá', async () => {
    const vb = await falesnyVstup((_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-aisha-identita': 'safetensors:abc', 'x-aisha-revize': 'r1', 'x-aisha-gpu-ms': '12' });
      res.end(JSON.stringify({ object: 'list', data: [{ embedding: [0.1, 0.2] }], model: 'e5' }));
    });
    const telo = JSON.stringify({ model: 'e5', input: ['ahoj'] });
    const o = await dotaz(await klient(vb.url), { headers: { authorization: 'Bearer klic-alfa' }, body: telo });
    expect(o.status).toBe(200);
    expect(o.telo.data[0].embedding).toEqual([0.1, 0.2]);
    expect([o.h.get('x-aisha-identita'), o.h.get('x-aisha-revize'), o.h.get('x-aisha-gpu-ms')]).toEqual(['safetensors:abc', 'r1', '12']);
    const p = vb.prijate.find((x) => x.url === '/v1/embeddings')!;
    expect(p.telo).toBe(telo);
    expect(p.headers.authorization).toBe('Bearer klic-alfa');
    expect(p.headers['x-aisha-trida']).toBe('dotaz');
    expect(Object.keys(p.headers).filter((k) => /^(x-forwarded|forwarded|via|x-real-ip)/.test(k))).toEqual([]);
  });

  it('bez Authorization dorazí bez Authorization — klient žádný klíč nemá ani nepřidá (K1)', async () => {
    const vb = await falesnyVstup((_q, res) => {
      res.writeHead(401, { 'content-type': 'application/json', 'x-aisha-odmitl': 'vstup' });
      res.end(JSON.stringify({ duvod: 'KLIC_CHYBI', error: 'chybí klíč (Bearer)' }));
    });
    const o = await dotaz(await klient(vb.url));
    expect([o.status, o.telo?.duvod, o.odmitl]).toEqual([401, 'KLIC_CHYBI', 'vstup']);
    expect(vb.prijate.find((x) => x.url === '/v1/embeddings')!.headers.authorization).toBeUndefined();
  });

  it('odchod dispatch → klient přeruší i vstup (vstup účtuje skutečnou dobu, Q5)', async () => {
    let preruseno!: () => void;
    const prerusenoP = new Promise<void>((r) => (preruseno = r));
    const vb = await falesnyVstup((_q, res) => {
      res.on('close', () => {
        if (!res.writableFinished) preruseno();
      });
    });
    const base = await klient(vb.url);
    const ac = new AbortController();
    const pozadavek = fetch(`${base}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisha-trida': 'davka' }, body: '{}', signal: ac.signal }).catch(() => null);
    await pockej(150);
    ac.abort();
    await pozadavek;
    await expect(Promise.race([prerusenoP.then(() => 'preruseno'), pockej(2000).then(() => 'visi')])).resolves.toBe('preruseno');
  });
});

describe('jediný upstream a jen peery meshe (MN6, M6)', () => {
  it('absolutní cíl požadavku nezpůsobí spojení jinam — jde na vstup jako cesta', async () => {
    let jinam = 0;
    const navnada = tcpServer((s) => {
      jinam++;
      s.destroy();
    });
    const portNavnady = await poslouchej(navnada);
    const vb = await falesnyVstup((_q, res) => {
      res.writeHead(404, { 'content-type': 'application/json', 'x-aisha-odmitl': 'vstup' });
      res.end(JSON.stringify({ duvod: 'CESTA_NEZNAMA', error: 'cesta neexistuje' }));
    });
    const base = new URL(await klient(vb.url));
    const odpoved = await new Promise<string>((resolve) => {
      const s = connect(Number(base.port), '127.0.0.1', () => s.write(`GET http://127.0.0.1:${portNavnady}/v1/models HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
      let d = '';
      s.on('data', (c) => (d += c));
      s.on('close', () => resolve(d));
    });
    expect(jinam).toBe(0);
    expect(vb.prijate.some((p) => p.url.includes(`:${portNavnady}/`))).toBe(true);
    expect(odpoved).toMatch(/CESTA_NEZNAMA/);
  });

  it('spojení, které nepřišlo z meshe, se zavře bez odpovědi a na vstup nedojde nic', async () => {
    const vb = await falesnyVstup((_q, res) => res.end('{}'));
    const base = await klient(vb.url, { prijmout: () => false });
    await expect(fetch(`${base}/v1/models`)).rejects.toThrow();
    expect(vb.spojeni()).toBe(0);
  });
});
