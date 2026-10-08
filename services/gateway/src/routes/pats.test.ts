import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Exercises POST /auth/v1/pats — the self-service PAT mint route. The KC→PostgREST token
// exchange (translateAuthorizationForPostgrest) and the outbound rpc/create_mcp_token fetch
// are mocked; the test asserts the route's guards + that it forwards the EXCHANGED (HS256)
// authorization to raw PostgREST with the caller-supplied story scope.

// ⛔ NAMĚŘENO 2026-09-05. Každý test si přes `vi.resetModules()` (v `inject` níž)
// znovu natahuje Fastify + auth.js, aby platil per-test `doMock`. Sólo: první test
// 604 ms, další ~409 ms. Pod třemi souběžnými offline sadami na témže stroji
// (cizí pracovní kopie `_wt-268`, `_wt-259`, `.wt-karantena`) první test dvakrát
// vyprchal na výchozích 5 000 ms (11:08 a 11:20) — push byl zamítnut kvůli cizí
// zátěži, ne kvůli regresi. Strop vychází z naměřeného dna (~0,4 s na test)
// s rezervou na sdílený hostitel; studený transform Fastify se zaplatí jednou
// tady, ne uvnitř prvního měřeného testu.
vi.setConfig({ testTimeout: 20_000 });
beforeAll(async () => {
  await import('fastify');
});

type Translate = { ok: true; authorization: string; translated: boolean } | { ok: false; status: number; error: string };

async function inject(opts: { translate: Translate; authHeader?: string; body?: unknown; fetchImpl?: typeof fetch }) {
  vi.resetModules();
  process.env.ALLOWED_REDIRECT_URIS = 'http://localhost:5173';
  process.env.POSTGREST_URL = 'http://postgrest.test:3000';
  vi.doMock('../auth/postgrest-jwt.js', () => ({
    translateAuthorizationForPostgrest: vi.fn(async () => opts.translate),
  }));
  if (opts.fetchImpl) vi.stubGlobal('fetch', opts.fetchImpl);
  const Fastify = (await import('fastify')).default;
  const { authRoutes } = await import('./auth.js');
  const app = Fastify();
  await app.register(authRoutes, { prefix: '/auth/v1' });
  const res = await app.inject({
    method: 'POST',
    url: '/auth/v1/pats',
    headers: { authorization: opts.authHeader ?? 'Bearer kc-token', 'content-type': 'application/json' },
    payload: opts.body ?? {},
  });
  await app.close();
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /auth/v1/pats — self-service PAT minting', () => {
  it('401 when the bearer is not a Keycloak token (no exchange happened)', async () => {
    const res = await inject({ translate: { ok: true, authorization: '', translated: false } });
    expect(res.statusCode).toBe(401);
  });

  it('propagates a token-exchange rejection (e.g. 403 keycloak_client_not_allowed)', async () => {
    const res = await inject({ translate: { ok: false, status: 403, error: 'keycloak_client_not_allowed' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'keycloak_client_not_allowed' });
  });

  it('400 when story_id is missing (self-service tokens are story-scoped)', async () => {
    const res = await inject({ translate: { ok: true, authorization: 'Bearer hs256', translated: true }, body: {} });
    expect(res.statusCode).toBe(400);
  });

  it('mints a PAT: forwards the EXCHANGED HS256 auth + story scope to rpc/create_mcp_token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token_id: 't1', raw_token: 'mcp_abc123' }), { status: 200 }));
    const res = await inject({
      translate: { ok: true, authorization: 'Bearer hs256jwt', translated: true },
      body: { story_id: 's-1', expires_in_days: 7 },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ raw_token: 'mcp_abc123' });
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(String(url)).toBe('http://postgrest.test:3000/rpc/create_mcp_token');
    expect(opts.headers.authorization).toBe('Bearer hs256jwt'); // the exchanged HS256, NOT the raw KC token
    const sent = JSON.parse(String(opts.body));
    expect(sent).toMatchObject({ p_scoped_to_story_id: 's-1', p_scope: 'story', p_expires_in_days: 7 });
  });

  it('propagates a mint rejection (42501 → 403) from create_mcp_token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'Cannot mint a token scoped to a story you cannot access' }), { status: 403 }));
    const res = await inject({
      translate: { ok: true, authorization: 'Bearer hs256', translated: true },
      body: { story_id: 's-inaccessible' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.statusCode).toBe(403);
  });

  it('502 when PostgREST is unreachable', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const res = await inject({
      translate: { ok: true, authorization: 'Bearer hs256', translated: true },
      body: { story_id: 's-1' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.statusCode).toBe(502);
  });
});

// ⛔ NAMĚŘENO 2026-10-03 (mapa mezer, nález G21): trasa do create_mcp_token neposílala
// seznam nástrojů, takže samoobslužný token měl `allowed_tools` prázdné a koncový bod MCP
// ho odmítal 403. Seznam je autorizace vlastníka tokenu; roli tahle trasa neurčuje.
describe('POST /auth/v1/pats — seznam nástrojů (allowed_tools)', () => {
  const prelozeno: Translate = { ok: true, authorization: 'Bearer hs256', translated: true };
  const VYDANY_TOKEN = { token_id: 't1', raw_token: 'mcp_abc123', scope: 'story', warning: 'Store this token securely. It cannot be retrieved again.' };
  const rpcVydaToken = () => vi.fn(async () => new Response(JSON.stringify(VYDANY_TOKEN), { status: 200 }));
  const odeslaneRpc = (fetchMock: ReturnType<typeof vi.fn>) =>
    JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;

  it('seznam předá RPC jako p_allowed_tools a odpověď je beze změny', async () => {
    const fetchMock = rpcVydaToken();
    const res = await inject({
      translate: prelozeno,
      body: { story_id: 's-1', allowed_tools: ['search_knowledge_v2', 'get_expert_rule'] },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.statusCode).toBe(200);
    expect(odeslaneRpc(fetchMock)).toMatchObject({
      p_scoped_to_story_id: 's-1',
      p_allowed_tools: ['search_knowledge_v2', 'get_expert_rule'],
    });
    expect(res.json(), 'token se seznamem upozornění nenese').toEqual(VYDANY_TOKEN);
  });

  it('bez seznamu token vznikne, parametr se neposílá a odpověď to řekne v mcp_warning', async () => {
    for (const telo of [{ story_id: 's-1' }, { story_id: 's-1', allowed_tools: [] }]) {
      const fetchMock = rpcVydaToken();
      const res = await inject({ translate: prelozeno, body: telo, fetchImpl: fetchMock as unknown as typeof fetch });
      expect(res.statusCode).toBe(200);
      expect(odeslaneRpc(fetchMock), 'bez seznamu platí výchozí hodnota funkce').not.toHaveProperty('p_allowed_tools');
      const odpoved = res.json() as Record<string, unknown>;
      expect(odpoved, 'pole z RPC zůstávají, včetně původního warning').toMatchObject(VYDANY_TOKEN);
      expect(String(odpoved.mcp_warning)).toMatch(/allowed_tools/);
      expect(String(odpoved.mcp_warning)).toMatch(/403/);
    }
  });

  it('neplatný seznam → 400 s důvodem a token se NEVYDÁ', async () => {
    const fetchMock = rpcVydaToken();
    const res = await inject({
      translate: prelozeno,
      body: { story_id: 's-1', allowed_tools: ['get_expert_rule', 'get_expert_rule'] },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    expect(String((res.json() as { message: string }).message)).toMatch(/víckrát/);
    expect(fetchMock, 'RPC se nesmí zavolat — tiché zahození by vydalo token bez seznamu').not.toHaveBeenCalled();
  });
});

// Tvar seznamu se ověřuje čistou funkcí — tady bez Fastify, aby každý případ nestál
// nové natažení modulů (viz měření u `inject` nahoře).
describe('overSeznamNastroju — tvar allowed_tools', () => {
  const over = async (hodnota: unknown) => (await import('./auth.js')).overSeznamNastroju(hodnota);

  it('chybějící a prázdné pole = token bez seznamu', async () => {
    expect(await over(undefined)).toEqual({ ok: true, seznam: [] });
    expect(await over([])).toEqual({ ok: true, seznam: [] });
  });

  it('platná jména projdou beze změny a v pořadí', async () => {
    const seznam = ['search_knowledge_v2', 'get_expert_rule', 'a', 'Nastroj-1.v2'];
    expect(await over(seznam)).toEqual({ ok: true, seznam });
  });

  it.each<[string, unknown, RegExp]>([
    ['není pole', 'search_knowledge_v2', /musí být pole/],
    ['null', null, /musí být pole/],
    ['objekt', { 0: 'search_knowledge_v2' }, /musí být pole/],
    ['položka není řetězec', ['search_knowledge_v2', 7], /allowed_tools\[1\]/],
    ['prázdný řetězec', [''], /allowed_tools\[0\]/],
    ['mezera ve jméně', ['search knowledge'], /allowed_tools\[0\]/],
    ['jméno začíná číslicí', ['1nastroj'], /allowed_tools\[0\]/],
    ['jméno delší než 64 znaků', ['a'.repeat(65)], /allowed_tools\[0\]/],
    ['duplicitní jméno', ['get_expert_rule', 'search_knowledge_v2', 'get_expert_rule'], /víckrát/],
    ['nad stropem počtu', Array.from({ length: 65 }, (_, i) => `nastroj_${i}`), /nejvýše 64/],
  ])('odmítne s důvodem: %s', async (_popis, hodnota, duvod) => {
    const vysledek = await over(hodnota);
    expect(vysledek.ok).toBe(false);
    expect(vysledek.ok === false && vysledek.duvod).toMatch(duvod);
  });

  it('kotva: hranice délky a počtu jsou hranice, ne zákaz', async () => {
    expect((await over(['a'.repeat(64)])).ok).toBe(true);
    expect((await over(Array.from({ length: 64 }, (_, i) => `nastroj_${i}`))).ok).toBe(true);
  });
});
