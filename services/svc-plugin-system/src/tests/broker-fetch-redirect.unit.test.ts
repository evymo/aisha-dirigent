/**
 * /sandbox/fetch — plugin přes broker neobejde SSRF guard ani nedostane své
 * hlavičky na jiný origin.
 *
 * Vada: broker volbu `redirect` od pluginu vůbec nečetl (shim ji ani neposílal)
 * a safeFetch následoval každé přesměrování se stejnými hlavičkami — i na jiný
 * povolený hostitel. Plugin, který chtěl 'manual', dostal následovanou odpověď;
 * a přesměrování z jednoho povoleného hostitele na druhý neslo pluginovy
 * API klíče s sebou.
 *
 * Měří se skutečný broker (Fastify inject) nad skutečným @aisha/security;
 * mockuje se jen globální fetch (upstream). Hostitelé jsou IP literály, takže
 * DNS lookup nejde do sítě.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const BROKER_SECRET = 'test-broker-secret-at-least-32-chars-long!!';
process.env.BROKER_TOKEN_SECRET = BROKER_SECRET;
process.env.PLUGIN_NETWORK_ALLOWLIST = '93.184.216.34,93.184.216.35';

const HOST_A = 'https://93.184.216.34';
const HOST_B = 'https://93.184.216.35';

const upstream = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

describe('/sandbox/fetch — redirect jde vždy přes SSRF guard', () => {
  let app: import('fastify').FastifyInstance;
  let token: string;

  beforeAll(async () => {
    const { SignJWT } = await import('jose');
    token = await new SignJWT({ kind: 'broker', source_ref: 'plugin-under-test', user_id: 'u' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('broker-subject')
      .setAudience('aisha-plugin-broker')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(BROKER_SECRET));

    vi.stubGlobal('fetch', upstream);
    const Fastify = (await import('fastify')).default;
    const { sandboxBrokerRoutes } = await import('../routes/broker.js');
    app = Fastify();
    await app.register(sandboxBrokerRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    upstream.mockReset();
  });

  function redirectThenOk(location: string) {
    upstream
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }))
      .mockResolvedValueOnce(new Response('cil', { status: 200 }));
  }

  const call = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/sandbox/fetch',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  it("redirect: 'manual' — broker vrátí 302 a nenásleduje", async () => {
    redirectThenOk(`${HOST_A}/next`);
    const res = await call({ url: `${HOST_A}/start`, redirect: 'manual' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 302, headers: { location: `${HOST_A}/next` } });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("redirect: 'error' — přesměrování se odmítne (403), druhý hop se nepošle", async () => {
    redirectThenOk(`${HOST_A}/next`);
    const res = await call({ url: `${HOST_A}/start`, redirect: 'error' });
    expect(res.statusCode).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('neznámá hodnota redirect → 400, upstream se nevolá', async () => {
    const res = await call({ url: `${HOST_A}/start`, redirect: 'folow' });
    expect(res.statusCode).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("bez redirect (starší shim) — výchozí 'follow' pod guardem", async () => {
    redirectThenOk(`${HOST_A}/next`);
    const res = await call({ url: `${HOST_A}/start` });
    expect(res.json()).toMatchObject({ status: 200, body: 'cil' });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('přesměrování na jiný povolený hostitel nenese hlavičky pluginu', async () => {
    redirectThenOk(`${HOST_B}/sink`);
    const res = await call({
      url: `${HOST_A}/start`,
      headers: { 'X-Api-Key': 'pluginuv-klic', Authorization: 'Bearer pluginuv-token', Accept: 'text/xml' },
    });
    expect(res.json()).toMatchObject({ status: 200 });
    expect(upstream).toHaveBeenCalledTimes(2);
    const [secondUrl, secondInit] = upstream.mock.calls[1];
    expect(String(secondUrl)).toBe(`${HOST_B}/sink`);
    const sent = new Headers(secondInit?.headers);
    expect(sent.get('x-api-key')).toBeNull();
    expect(sent.get('authorization')).toBeNull();
    expect(sent.get('accept')).toBe('text/xml');
  });
});
