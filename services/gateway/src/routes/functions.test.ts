import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { functionsProxy } from './functions.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();

  app.addContentTypeParser(
    ['multipart/form-data', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
      done(null, body);
    },
  );

  await app.register(functionsProxy, { prefix: '/functions/v1' });
  return app;
}

function okResponse(): Response {
  return new Response(Buffer.from('ok'), {
    status: 202,
    headers: { 'content-type': 'text/plain' },
  });
}

// ⛔ ADRESA SLUŽBY SE V TESTU DEKLARUJE (2026-08-25).
//
// Do teď test očekával `http://svc-plugin-system:3029` — a nikde ho nenastavoval.
// Fungoval proto, že routovací tabulka měla `?? 'http://svc-plugin-system:3029'`,
// tedy TICHÝ default na ploché jméno. Test tak neověřoval kontrakt, ale
// PRODUKČNÍ FALLBACK — a kdyby ho někdo změnil, test by spadl na hodnotě, kterou
// sám nikdy nedeklaroval.
//
// Fallbacky jsou pryč (adresa se nehádá), takže test si upstream nastaví sám.
// Mesh tvar tu je záměrně: je to jméno, jaké doručuje cold-start.
const PLUGIN_UPSTREAM = 'http://test-plugin-system.mesh.test.internal:3029';
const MCP_UPSTREAM = 'http://test-mcp-knowledge.mesh.test.internal:3017';

describe('functionsProxy body forwarding', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env.PLUGIN_SERVICE_URL = PLUGIN_UPSTREAM;
    process.env.SVC_MCP_KNOWLEDGE_URL = MCP_UPSTREAM;
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  it('preserves JSON bodies on arbitrary-depth function subpaths', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/functions/v1/plugin-host/tools/run?dry=1',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        'x-request-id': 'req-json',
      },
      payload: { plugin_id: 'demo.plugin', args: { value: 1 } },
    });

    expect(response.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PLUGIN_UPSTREAM}/execute/tools/run?dry=1`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer token',
      'content-type': 'application/json',
      'x-request-id': 'req-json',
    });
    expect(init.body).toBe(JSON.stringify({ plugin_id: 'demo.plugin', args: { value: 1 } }));
  });

  it('preserves multipart/binary bodies on arbitrary-depth function subpaths', async () => {
    const payload = Buffer.from('--aisha\r\nContent-Disposition: form-data; name="file"\r\n\r\nhello\r\n--aisha--');

    const response = await app.inject({
      method: 'POST',
      url: '/functions/v1/ragnarok-upload/tools/import?dry=1',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'multipart/form-data; boundary=aisha',
        'x-request-id': 'req-upload',
      },
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MCP_UPSTREAM}/ragnarok/upload/tools/import?dry=1`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer token',
      'content-type': 'multipart/form-data; boundary=aisha',
      'x-request-id': 'req-upload',
    });
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(init.body as ArrayBuffer).equals(payload)).toBe(true);
  });

  /**
   * ⛔ NAMĚŘENO 2026-09-14: proxy zahazovala hlavičky, kterými protokol MCP
   * (Streamable HTTP) nese stav — klient n8n (@modelcontextprotocol/sdk 1.20)
   * posílá `accept: application/json, text/event-stream` a po initialize
   * `mcp-protocol-version`. Služba pak nevěděla, s jakou verzí mluví.
   */
  it('předává hlavičky protokolu MCP a vrací 202/405 beze změny', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 202 }));
    const notifikace = await app.inject({
      method: 'POST',
      url: '/functions/v1/mcp-knowledge-server',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        'mcp-session-id': 'relace-1',
      },
      payload: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
    expect(notifikace.statusCode).toBe(202);
    expect(notifikace.body).toBe('');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MCP_UPSTREAM}/mcp`);
    expect(init.headers).toMatchObject({
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      'mcp-session-id': 'relace-1',
    });

    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 405, headers: { allow: 'POST' } }));
    const get = await app.inject({
      method: 'GET',
      url: '/functions/v1/mcp-knowledge-server',
      headers: { accept: 'text/event-stream', authorization: 'Bearer token' },
    });
    expect(get.statusCode, 'klient 405 na GET bere jako „server nenabízí SSE" — proxy ho nesmí přebít').toBe(405);
    expect(get.headers.allow).toBe('POST');
  });
});

describe('functionsProxy předá upstreamu SPOČÍTANOU adresu klienta', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env.PLUGIN_SERVICE_URL = PLUGIN_UPSTREAM;
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  const odeslane = async (xff?: string) => {
    await app.inject({
      method: 'POST',
      url: '/functions/v1/plugin-host',
      headers: { 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) },
      payload: {},
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return (init.headers as Record<string, string>)['x-forwarded-for'];
  };

  it('klient za našimi proxy dorazí upstreamu jako jediná adresa', async () => {
    expect(await odeslane('203.0.113.9, 10.0.0.5')).toBe('203.0.113.9');
  });

  it('⛔ podvržená levá položka se NEPŘEDÁ — bere se první nedůvěryhodná zprava', async () => {
    expect(await odeslane('1.2.3.4, 203.0.113.9, 10.0.0.5')).toBe('203.0.113.9');
  });

  it('bez hlavičky se adresa nevymýšlí', async () => {
    expect(await odeslane()).toBeUndefined();
  });
});


// ⛔ STROP ČEKÁNÍ PODLE TRASY (2026-09-30). Pevných 30 s pro všechno vracelo
// plánované dávce dopočtu vektorů (n8n WF_EMBEDDING_V1_BACKFILL, max_ms 540 s)
// 502 v KAŽDÉM běhu — služba přitom kódovala dál. Měří se, jaký strop proxy
// SKUTEČNĚ nastaví: dávka strop služby + rezervu, ostatní výchozích 30 s.
describe('functionsProxy strop čekání podle trasy', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.PLUGIN_SERVICE_URL = PLUGIN_UPSTREAM;
    process.env.SVC_MCP_KNOWLEDGE_URL = MCP_UPSTREAM;
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const strop = async (url: string): Promise<number | undefined> => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await app.inject({ method: 'POST', url, payload: { batch_size: 1 } });
    return spy.mock.calls.at(-1)?.[0];
  };

  it('dávka dopočtu vektorů čeká déle než strop služby (600 s)', async () => {
    expect(await strop('/functions/v1/backfill-knowledge-embeddings-v1')).toBeGreaterThan(600_000);
  });

  it('ostatní trasy drží výchozích 30 s — i na podcestě', async () => {
    expect(await strop('/functions/v1/generate-knowledge-embeddings')).toBe(30_000);
    expect(await strop('/functions/v1/plugin-host/tools/run')).toBe(30_000);
  });
});
