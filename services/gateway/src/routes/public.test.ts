import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Adresa zdrojové aplikace se v testu DEKLARUJE — brána bez ní odpovídá 503
// a to je jiný kontrakt, než který tu ověřujeme.
vi.mock('../config.js', () => ({
  config: {
    postgrestUrl: 'http://postgrest.test',
    sourceApiUrl: 'http://testfork-source-api:8000',
  },
}));
vi.mock('../auth/postgrest-jwt.js', () => ({
  translateAuthorizationForPostgrest: vi.fn(),
}));

import { publicRoutes } from './public.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(publicRoutes, { prefix: '/public' });
  return app;
}

function json(telo: unknown, status = 200): Response {
  return new Response(JSON.stringify(telo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GET /public/community-count', () => {
  let app: FastifyInstance;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  // ⛔ NAPSÁNO ČERVENÉ proti dřívějšímu čtení `telo.user_count` (naměřeno
  // 2026-09-03 na produkci `<fork>`): source-api obaluje každou odpověď do `result`
  // (DRF RetrieveAPIView → Response({'result': serializer.data})). Brána
  // dostávala undefined a vracela 502, ačkoli backend žil — počítadlo
  // komunity se nikdy nevykreslilo.
  it('čte počet z obálky result — tvar, který source-api doopravdy posílá', async () => {
    fetchMock.mockResolvedValueOnce(json({ result: { user_count: 4 } }));

    const r = await app.inject({ method: 'GET', url: '/public/community-count' });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ count: 4, source: 'source-api' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://testfork-source-api:8000/v3/public/user_count/',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('počet na vrchu bez obálky NENÍ kontrakt source-api — hlásí se jako neplatný tvar', async () => {
    fetchMock.mockResolvedValueOnce(json({ user_count: 4 }));

    const r = await app.inject({ method: 'GET', url: '/public/community-count' });

    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: 'upstream_payload_invalid' });
  });

  it('nula ani nečíslo se nepropíše — radši přiznat, že se číslo nezjistilo', async () => {
    fetchMock.mockResolvedValueOnce(json({ result: { user_count: 0 } }));

    const r = await app.inject({ method: 'GET', url: '/public/community-count' });

    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: 'upstream_payload_invalid' });
  });

  it('nedostupný backend se pojmenuje, nesplyne s chybným tvarem', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const r = await app.inject({ method: 'GET', url: '/public/community-count' });

    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: 'upstream_unreachable' });
  });

  it('chyba backendu nese jeho stavový kód', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'nope' }, 500));

    const r = await app.inject({ method: 'GET', url: '/public/community-count' });

    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: 'upstream_error', status: 500 });
  });
});
