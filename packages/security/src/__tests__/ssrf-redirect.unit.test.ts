/**
 * safeFetch — přesměrování nenese tajemství volajícího jinam.
 *
 * Vada, kterou tento test drží: safeFetch sice každý hop znovu prověřil
 * check(), ale posílal na něj STEJNÉ `init` — hlavičky (Authorization, API
 * klíče, cookies), metodu i tělo — i na jiný origin, pokud prošel allowlistem.
 * Kdo ovládá přesměrování na povoleném hostiteli (nebo otevřený redirect),
 * dostal tajemství volajícího. 303 z POST navíc znovu poslal POST s tělem.
 *
 * Měří se na skutečném HTTP: dva originy = dva porty na 127.0.0.1, oba
 * v allowlistu. DNS lookup je zamockovaný na veřejnou adresu, jinak by IP
 * stráž (správně) odmítla loopback — samotné spojení jde na 127.0.0.1.
 * Každá negativní sonda má pozitivní protějšek (stejný origin hlavičky DOSTANE,
 * cizí origin dostane neutrální `accept`/`user-agent`), aby test nemohl projít
 * jen proto, že server hlavičky nevidí vůbec.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => ({ address: '93.184.216.34', family: 4 })),
}));

import { createSsrfGuard, planRedirect, SsrfBlockedError, type RedirectHop } from '../ssrf.js';

interface Seen {
  path: string;
  method: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface Origin {
  server: Server;
  base: string;
  seen: Seen[];
}

/**
 * `/sink` odpoví 200. `/redirect?status=N&to=<url>` odpoví N s Location <url>.
 * Každý požadavek (včetně těla) se zaznamená.
 */
async function startOrigin(): Promise<Origin> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://placeholder');
      seen.push({
        path: url.pathname,
        method: req.method ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (url.pathname === '/redirect') {
        res.writeHead(Number(url.searchParams.get('status')), { location: url.searchParams.get('to') ?? '' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}`, seen };
}

function redirectUrl(from: Origin, status: number, to: string): string {
  return `${from.base}/redirect?status=${status}&to=${encodeURIComponent(to)}`;
}

const SECRET_HEADERS = {
  Authorization: 'Bearer tajny-token-volajiciho',
  'X-Api-Key': 'tajny-api-klic',
  Cookie: 'session=tajna-session',
};
const NEUTRAL_HEADERS = { Accept: 'application/json', 'User-Agent': 'aisha-test-agent' };

let a: Origin;
let b: Origin;
const guard = createSsrfGuard({
  service: 'svc-test',
  hostAllowlist: ['127.0.0.1'],
  allowedSchemes: ['http:'],
});

beforeAll(async () => {
  a = await startOrigin();
  b = await startOrigin();
});

afterAll(async () => {
  for (const o of [a, b]) {
    o.server.closeAllConnections();
    await new Promise<void>((resolve) => o.server.close(() => resolve()));
  }
});

beforeEach(() => {
  a.seen.length = 0;
  b.seen.length = 0;
});

const sinkHits = (o: Origin) => o.seen.filter((s) => s.path === '/sink');

describe('safeFetch — cizí origin nedostane hlavičky volajícího', () => {
  test('302 na cizí origin: Authorization, API klíč ani Cookie nedorazí; neutrální hlavičky ano', async () => {
    const res = await guard.safeFetch(redirectUrl(a, 302, `${b.base}/sink`), {
      headers: { ...SECRET_HEADERS, ...NEUTRAL_HEADERS },
    });
    expect(res.status).toBe(200);
    const [hit] = sinkHits(b);
    expect(hit, 'cíl přesměrování musí být navštíven').toBeDefined();
    expect(hit.headers.authorization).toBeUndefined();
    expect(hit.headers['x-api-key']).toBeUndefined();
    expect(hit.headers.cookie).toBeUndefined();
    // Pozitivní kontrola sondy: neutrální hlavičky projdou, server je tedy vidí.
    expect(hit.headers.accept).toBe('application/json');
    expect(hit.headers['user-agent']).toBe('aisha-test-agent');
  });

  test('stejný origin (302) hlavičky volajícího DOSTANE', async () => {
    const res = await guard.safeFetch(redirectUrl(a, 302, `${a.base}/sink`), { headers: SECRET_HEADERS });
    expect(res.status).toBe(200);
    const [hit] = sinkHits(a);
    expect(hit.headers.authorization).toBe(SECRET_HEADERS.Authorization);
    expect(hit.headers['x-api-key']).toBe(SECRET_HEADERS['X-Api-Key']);
    expect(hit.headers.cookie).toBe(SECRET_HEADERS.Cookie);
  });

  test('A → B → A: jednou odebrané hlavičky se návratem na původní origin neobnoví', async () => {
    const backToA = redirectUrl(b, 302, `${a.base}/sink`);
    const res = await guard.safeFetch(redirectUrl(a, 302, backToA), { headers: SECRET_HEADERS });
    expect(res.status).toBe(200);
    const [hit] = sinkHits(a);
    expect(hit, 'řetěz musí dojít zpět na A').toBeDefined();
    expect(hit.headers.authorization).toBeUndefined();
    expect(hit.headers['x-api-key']).toBeUndefined();
  });
});

describe('safeFetch — metoda a tělo podle HTTP sémantiky', () => {
  test('303 z POST → GET bez těla a bez hlaviček těla', async () => {
    const res = await guard.safeFetch(redirectUrl(a, 303, `${a.base}/sink`), {
      method: 'POST',
      headers: { ...SECRET_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ heslo: 'tajne' }),
    });
    expect(res.status).toBe(200);
    const [hit] = sinkHits(a);
    expect(hit.method).toBe('GET');
    expect(hit.body).toBe('');
    expect(hit.headers['content-type']).toBeUndefined();
    // Stejný origin — pověření zůstává.
    expect(hit.headers.authorization).toBe(SECRET_HEADERS.Authorization);
  });

  test('302 z POST na cizí origin → GET bez těla a bez pověření', async () => {
    const res = await guard.safeFetch(redirectUrl(a, 302, `${b.base}/sink`), {
      method: 'POST',
      headers: { ...SECRET_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ heslo: 'tajne' }),
    });
    expect(res.status).toBe(200);
    const [hit] = sinkHits(b);
    expect(hit.method).toBe('GET');
    expect(hit.body).toBe('');
    expect(hit.headers.authorization).toBeUndefined();
  });

  test('307 s tělem na cizí origin se NENÁSLEDUJE — volající dostane 307 a tělo nikam neodejde', async () => {
    const res = await guard.safeFetch(redirectUrl(a, 307, `${b.base}/sink`), {
      method: 'POST',
      headers: SECRET_HEADERS,
      body: JSON.stringify({ heslo: 'tajne' }),
    });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${b.base}/sink`);
    expect(b.seen, 'cizí origin nesmí dostat vůbec žádný požadavek').toHaveLength(0);
  });

  test('308 s tělem na cizí origin se NENÁSLEDUJE', async () => {
    const res = await guard.safeFetch(redirectUrl(a, 308, `${b.base}/sink`), {
      method: 'PUT',
      body: 'data',
    });
    expect(res.status).toBe(308);
    expect(b.seen).toHaveLength(0);
  });

  test('307 s tělem na stejný origin zachová metodu, tělo i hlavičky', async () => {
    const res = await guard.safeFetch(redirectUrl(a, 307, `${a.base}/sink`), {
      method: 'POST',
      headers: SECRET_HEADERS,
      body: 'payload-307',
    });
    expect(res.status).toBe(200);
    const [hit] = sinkHits(a);
    expect(hit.method).toBe('POST');
    expect(hit.body).toBe('payload-307');
    expect(hit.headers.authorization).toBe(SECRET_HEADERS.Authorization);
  });
});

describe('safeFetch — volba redirect volajícího platí a guard neobchází', () => {
  test("redirect: 'manual' vrátí 3xx a nenásleduje", async () => {
    const res = await guard.safeFetch(redirectUrl(a, 302, `${b.base}/sink`), { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(b.seen).toHaveLength(0);
  });

  test("redirect: 'error' odmítne přesměrování", async () => {
    await expect(
      guard.safeFetch(redirectUrl(a, 302, `${b.base}/sink`), { redirect: 'error' }),
    ).rejects.toMatchObject({ name: 'SsrfBlockedError', reason: 'redirect' });
    expect(b.seen).toHaveLength(0);
  });

  test('neznámá hodnota redirect se odmítne, nekoerguje', async () => {
    await expect(
      guard.safeFetch(`${a.base}/sink`, { redirect: 'folow' as RequestRedirect }),
    ).rejects.toMatchObject({ reason: 'redirect' });
    expect(a.seen).toHaveLength(0);
  });
});

describe('safeFetch — https → http downgrade', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('odmítne se i když allowedSchemes http: povoluje; druhý hop se nepošle', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://api.example.com/x' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const mixed = createSsrfGuard({
      service: 'svc-test',
      hostAllowlist: ['api.example.com'],
      allowedSchemes: ['https:', 'http:'],
    });
    await expect(
      mixed.safeFetch('https://api.example.com/start', { headers: SECRET_HEADERS }),
    ).rejects.toMatchObject({ name: 'SsrfBlockedError', reason: 'redirect' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('planRedirect — rozhodovací funkce (bez I/O)', () => {
  const hop = (over: Partial<RedirectHop> = {}): RedirectHop => ({
    url: new URL('https://a.example.com/start'),
    method: 'GET',
    headers: new Headers(SECRET_HEADERS),
    body: null,
    ...over,
  });

  test('https → http je SsrfBlockedError(redirect)', () => {
    expect(() => planRedirect(hop(), 301, 'http://a.example.com/x')).toThrow(SsrfBlockedError);
  });

  test('https → https cizí origin: projde, ale bez pověření', () => {
    const plan = planRedirect(hop(), 301, 'https://b.example.com/x');
    expect(plan.kind).toBe('follow');
    if (plan.kind !== 'follow') return;
    expect(plan.next.headers.get('authorization')).toBeNull();
  });

  test('allowlist, ne denylist: libovolně pojmenovaná hlavička s tajemstvím na cizí origin neodejde', () => {
    const plan = planRedirect(
      hop({ headers: new Headers({ 'X-Plugin-Whatever': 'tajne', Accept: 'text/html' }) }),
      302,
      'https://b.example.com/x',
    );
    if (plan.kind !== 'follow') throw new Error('expected follow');
    expect([...plan.next.headers.keys()]).toEqual(['accept']);
  });

  test('jiný port = jiný origin', () => {
    const plan = planRedirect(hop(), 302, 'https://a.example.com:8443/x');
    if (plan.kind !== 'follow') throw new Error('expected follow');
    expect(plan.next.headers.get('authorization')).toBeNull();
  });

  test('308 bez těla na cizí origin se následuje se zachovanou metodou', () => {
    const plan = planRedirect(hop({ method: 'PUT' }), 308, 'https://b.example.com/x');
    if (plan.kind !== 'follow') throw new Error('expected follow');
    expect(plan.next.method).toBe('PUT');
    expect(plan.next.headers.get('cookie')).toBeNull();
  });

  test('303 z HEAD zůstane HEAD', () => {
    const plan = planRedirect(hop({ method: 'HEAD' }), 303, '/x');
    if (plan.kind !== 'follow') throw new Error('expected follow');
    expect(plan.next.method).toBe('HEAD');
  });

  test('301 z DELETE → GET bez těla', () => {
    const plan = planRedirect(hop({ method: 'DELETE', body: 'x' }), 301, '/x');
    if (plan.kind !== 'follow') throw new Error('expected follow');
    expect(plan.next.method).toBe('GET');
    expect(plan.next.body).toBeNull();
  });

  test('307 se streamovaným tělem na stejný origin nejde zopakovat → odmítnuto, ne prázdné tělo', () => {
    const stream = new ReadableStream({ start: (c) => c.close() });
    expect(() => planRedirect(hop({ method: 'POST', body: stream }), 307, '/x')).toThrow(/streamed request body/);
  });

  test('neparsovatelná Location je SsrfBlockedError(redirect)', () => {
    expect(() => planRedirect(hop(), 302, 'https://[nezavreno')).toThrow(SsrfBlockedError);
  });
});
