/**
 * KB hledání v /mcp běží identitou uživatele, ne pod službou (B8).
 *
 * ⛔ NAMĚŘENO 2026-10-01 na main 8640db9ac: searchKnowledgeProd volal mcp_search_knowledge_v3
 * (a záložně v2) přes rpcService se story z claimu. RPC stráž příběhu pro službu přeskakuje,
 * takže claim, který nikdo neověřil (/v1 bral story z těla požadavku), otevřel KB cizího
 * příběhu. Teď jde hledání přes rpcUserClaims a stráž v RPC platí vždy.
 *
 * Co se tu měří:
 *   1. vektorová cesta: v3 identitou uživatele, story i publikum z ověřeného tokenu ← kontrolní vzorek
 *   2. embedding nejde: hledání selže NAHLAS (embedding_unavailable) — žádná textová záloha v2
 *      (P2 2026-10-06; dřív tu byla záloha v2 identitou uživatele)
 *   3. RPC cizí příběh odmítne (42501) → nástroj vrátí chybu, žádná data; služba se nevolá
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const MockAuthError = vi.hoisted(() => class extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; }
});
const identitaMock = vi.hoisted(() => vi.fn());
const rpcServiceMock = vi.hoisted(() => vi.fn(async () => null));
const rpcUserClaimsMock = vi.hoisted(() => vi.fn(async () => [{ chunk_text: 'muj obsah' }]));
const embedMock = vi.hoisted(() => vi.fn());

vi.mock('../auth.js', () => ({
  verifyMcpToken: identitaMock,
  verifyToken: vi.fn(),
  isAdminOrStaff: (u: { roles: string[] }) => u.roles.includes('admin') || u.roles.includes('staff'),
  AuthError: MockAuthError,
}));
vi.mock('../postgrest.js', () => ({ rpcService: rpcServiceMock, rpcUserClaims: rpcUserClaimsMock }));
vi.mock('../lib/aitg-tools.js', () => ({ aitgDispatch: vi.fn() }));
vi.mock('../lib/flowboard-tools.js', () => ({ flowboardDispatch: vi.fn() }));
vi.mock('../lib/embed-query-in-space.js', () => ({ embedQueryForProfile: embedMock }));

import { mcpRoutes } from '../routes/mcp.js';
import { EmbeddingSpaceUnresolvedError } from '../lib/knowledge-search-unavailable.js';

const UZIVATEL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PRIBEH = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const claims = { sub: UZIVATEL, role: 'authenticated', story_id: PRIBEH, token_use: 'omni-mcp-mediation' };
const EMBEDDED = {
  ragSpace: 'v1', queryEmbeddingV1: [0.1, 0.2], queryEmbeddingV2: null,
  backend: { model_id: 'model-x' },
};

describe('KB hledání v /mcp identitou uživatele (B8)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    identitaMock.mockReset();
    identitaMock.mockResolvedValue({ userId: UZIVATEL, roles: ['authenticated'], scopes: [], claims });
    rpcServiceMock.mockClear();
    rpcUserClaimsMock.mockReset();
    rpcUserClaimsMock.mockResolvedValue([{ chunk_text: 'muj obsah' }]);
    embedMock.mockReset();
    app = Fastify(); await app.register(mcpRoutes); await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const hledej = () => app.inject({
    method: 'POST', url: '/mcp',
    headers: { authorization: 'Bearer zprostredkovany', 'content-type': 'application/json' },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_knowledge_v2', arguments: { query: 'hlavní město' } } },
  });

  const sluzbouNaKb = () => (rpcServiceMock.mock.calls as unknown as Array<[string]>).filter(([fn]) => /^mcp_search_knowledge_v[23]$/.test(fn));

  it('vektorová cesta: v3 identitou uživatele, story i publikum z tokenu (kontrolní vzorek)', async () => {
    embedMock.mockResolvedValue(EMBEDDED);
    const r = await hledej();
    expect(r.statusCode).toBe(200);
    expect(r.json().result.content[0].text).toContain('muj obsah');
    expect(rpcUserClaimsMock).toHaveBeenCalledWith(
      'mcp_search_knowledge_v3',
      expect.objectContaining({ p_story_id: PRIBEH, p_audience_user_id: UZIVATEL, p_query_text: 'hlavní město' }),
      claims,
    );
    expect(sluzbouNaKb()).toEqual([]);
  });

  it('embedding nejde: nástroj selže nahlas (embedding_unavailable), textové hledání v2 se nevolá (P2)', async () => {
    embedMock.mockRejectedValue(new EmbeddingSpaceUnresolvedError('resolver nevrátil model'));
    const r = await hledej();
    expect(r.statusCode).toBe(200);
    expect(r.json().result.isError).toBe(true);
    expect(r.json().result.structuredContent).toMatchObject({ error: 'embedding_unavailable', reason: 'embedding_backend' });
    const kb = (rpcUserClaimsMock.mock.calls as unknown as Array<[string]>).filter(([fn]) => /^mcp_search_knowledge/.test(fn));
    expect(kb, 'žádné hledání (ani textové) při výpadku embeddingu').toEqual([]);
    expect(sluzbouNaKb()).toEqual([]);
  });

  it('RPC cizí příběh odmítne → nástroj vrátí chybu, žádná data; služba se nevolá', async () => {
    embedMock.mockResolvedValue(EMBEDDED);
    rpcUserClaimsMock.mockRejectedValue(new Error('Access denied to story (42501)'));
    const r = await hledej();
    // Text chyby (Access denied …) jde jen do logu služby; volajícímu obecná zpráva + incident.
    expect(r.json().error?.message).toMatch(/^MCP tool call failed \(incident [0-9a-f-]{36}\)$/);
    expect(r.json().result).toBeUndefined();
    expect(sluzbouNaKb()).toEqual([]);
  });
});
