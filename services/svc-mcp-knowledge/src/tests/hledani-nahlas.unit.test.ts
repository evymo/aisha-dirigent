/**
 * Vektorové hledání ve znalostech selže NAHLAS a předává identitu vah (P2, 2026-10-06).
 *
 * ⛔ NAMĚŘENO 2026-10-06 (riq): při výpadku embeddingu searchKnowledgeProd tiše přešel na textové
 * hledání v2 a v3 filtrovala jen podle jména modelu. Měří se:
 *   1. identitu vah, kterou lane ohlásila k vektoru dotazu, ověří SLUŽBA proti deklaraci před
 *      hledáním; v3 identitu od volajícího nedostane (revize bezpečnosti 2026-10-07: orákulum);
 *   2. každý druh výpadku = výsledek nástroje `isError` s `embedding_unavailable` a důvodem
 *      (resolver bez modelu, lane/kvóta, nedeklarovaná identita, nesouhlasná identita);
 *   3. žádné textové hledání při výpadku (ani v2, ani v1);
 *   4. jiná chyba RPC (cizí příběh) nedostupností NENÍ — projde jako chyba protokolu;
 *   5. (revize 2026-10-07) odpověď nese jen kód, důvod, kód lane a id incidentu — NIKDY text
 *      chyby (hostitelé, URL, identita vah); text jde jen do logu služby pod týmž incidentem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const MockAuthError = vi.hoisted(() => class extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; }
});
const identitaMock = vi.hoisted(() => vi.fn());
const rpcServiceMock = vi.hoisted(() => vi.fn(async (_fn: string, _args?: unknown): Promise<unknown> => null));
const rpcUserClaimsMock = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
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
import {
  EmbeddingSpaceUnresolvedError,
  nedostupnostZEmbeddingu,
  nedostupnostZIdentity,
} from '../lib/knowledge-search-unavailable.js';
import { EmbedDispatchError } from '../lib/embed-dispatcher.js';
import { resetLogSink, setLogSink, type SafeLogEntry } from '@aisha/security';

const UZIVATEL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const claims = { sub: UZIVATEL, role: 'authenticated', token_use: 'omni-mcp-mediation' };
const IDENTITA = `pytorch:${'a'.repeat(64)}`;
const EMBEDDED = {
  ragSpace: 'v1', queryEmbeddingV1: [0.1, 0.2], queryEmbeddingV2: null,
  backend: { model_id: 'embed-x' },
  identita: { identita: IDENTITA, revize: null, recept: 'embed_text_v1' },
};

describe('search_knowledge_v2: identita vah a selhání nahlas (P2)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    identitaMock.mockReset();
    identitaMock.mockResolvedValue({ userId: UZIVATEL, roles: ['authenticated'], scopes: [], claims });
    rpcServiceMock.mockReset();
    // Služební rovina: deklarace vah modelu (fn_deklarace_vah_embeddingu).
    rpcServiceMock.mockImplementation(async (fn: string) => (fn === 'fn_deklarace_vah_embeddingu' ? [{ identita: IDENTITA }] : null));
    rpcUserClaimsMock.mockReset();
    rpcUserClaimsMock.mockResolvedValue([{ chunk_id: 'c1', chunk_text: 'úryvek' }]);
    embedMock.mockReset();
    app = Fastify(); await app.register(mcpRoutes); await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const hledej = () => app.inject({
    method: 'POST', url: '/mcp',
    headers: { authorization: 'Bearer zprostredkovany', 'content-type': 'application/json' },
    payload: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search_knowledge_v2', arguments: { query: 'výpověď smlouvy' } } },
  });
  const kbVolani = () => [...rpcUserClaimsMock.mock.calls, ...rpcServiceMock.mock.calls]
    .map((c) => (c as unknown as [string])[0])
    .filter((fn) => /^mcp_search_knowledge/.test(fn));

  it('identitu z lane ověří služba proti deklaraci; v3 dostane model, NE identitu od volajícího', async () => {
    embedMock.mockResolvedValue(EMBEDDED);
    const r = await hledej();
    expect(r.json().result.isError).toBeUndefined();
    expect(rpcServiceMock).toHaveBeenCalledWith('fn_deklarace_vah_embeddingu', { p_model_id: 'embed-x' });
    const [, argumenty] = rpcUserClaimsMock.mock.calls.find((c) => (c as unknown as [string])[0] === 'mcp_search_knowledge_v3') as unknown as [string, Record<string, unknown>];
    expect(argumenty).toMatchObject({ p_query_model: 'embed-x' });
    expect(argumenty).not.toHaveProperty('p_query_identity');
  });

  it('backend bez identity (llama.cpp) → nic k ověření, platí deklarace ve filtru v3', async () => {
    embedMock.mockResolvedValue({ ...EMBEDDED, identita: null });
    await hledej();
    expect(rpcServiceMock).not.toHaveBeenCalledWith('fn_deklarace_vah_embeddingu', expect.anything());
    expect(rpcUserClaimsMock).toHaveBeenCalledWith('mcp_search_knowledge_v3', expect.objectContaining({ p_query_model: 'embed-x' }), claims);
  });

  const pripady: Array<[string, () => void, string, string | undefined]> = [
    ['resolver bez modelu', () => embedMock.mockRejectedValue(new EmbeddingSpaceUnresolvedError('žádný model v1')), 'embedding_backend', undefined],
    ['lane nedostupná', () => embedMock.mockRejectedValue(new EmbedDispatchError(503, 'lane odmítla embed: LANE_NEDOSTUPNA', '', 'LANE_NEDOSTUPNA')), 'embedding_selhal', 'LANE_NEDOSTUPNA'],
    ['kvóta nájemce', () => embedMock.mockRejectedValue(new EmbedDispatchError(429, 'lane odmítla embed: KVOTA_PREKROCENA', '', 'KVOTA_PREKROCENA')), 'embedding_selhal', 'KVOTA_PREKROCENA'],
    ['síť (obecná chyba)', () => embedMock.mockRejectedValue(new Error('ECONNRESET')), 'embedding_selhal', undefined],
    ['nedeklarovaná identita (v3)', () => {
      embedMock.mockResolvedValue(EMBEDDED);
      rpcUserClaimsMock.mockRejectedValue(new Error('PostgREST rpc/mcp_search_knowledge_v3 failed (400): {"code":"22023","message":"živá identita embeddingu embed-x neznámá (embedding_identity_undeclared): …"}'));
    }, 'identita_nedeklarovana', undefined],
    ['lane ohlásila jinou identitu, než data deklarují (služba)', () => {
      embedMock.mockResolvedValue(EMBEDDED);
      rpcServiceMock.mockImplementation(async (fn: string) => (fn === 'fn_deklarace_vah_embeddingu' ? [{ identita: `gguf:${'b'.repeat(64)}` }] : null));
    }, 'identita_nesouhlasi', undefined],
    ['deklarace chybí při kontrole služby', () => {
      embedMock.mockResolvedValue(EMBEDDED);
      rpcServiceMock.mockImplementation(async (fn: string) => {
        if (fn === 'fn_deklarace_vah_embeddingu') throw new Error('PostgREST rpc/fn_deklarace_vah_embeddingu failed (400): {"code":"22023","message":"živá identita embeddingu embed-x neznámá (embedding_identity_undeclared): data instance nedeklarují ai_model_registry.provider_metadata.declared.weights_sha256"}');
        return null;
      });
    }, 'identita_nedeklarovana', undefined],
  ];

  for (const [nazev, priprav, duvod, lane] of pripady) {
    it(`${nazev} → isError embedding_unavailable (${duvod}), žádné textové hledání`, async () => {
      priprav();
      const r = await hledej();
      expect(r.statusCode).toBe(200);
      const vysledek = r.json().result;
      expect(vysledek?.isError, 'výpadek musí být chyba nástroje, ne výsledek').toBe(true);
      expect(vysledek.structuredContent).toMatchObject({ error: 'embedding_unavailable', reason: duvod, tool: 'search_knowledge_v2' });
      if (lane) expect(vysledek.structuredContent.lane).toBe(lane);
      // Text nese týž JSON (klienti bez structuredContent: n8n, starší IDE).
      expect(JSON.parse(vysledek.content[0].text)).toMatchObject({ error: 'embedding_unavailable', reason: duvod });
      expect(kbVolani().filter((fn) => fn !== 'mcp_search_knowledge_v3'), 'žádná textová záloha').toEqual([]);
      if (duvod === 'identita_nesouhlasi') expect(kbVolani(), 'při nesouhlasu identity se nehledá').toEqual([]);
    });
  }

  it('⛔ odpověď NIKDY nenese text chyby (hostitel, URL, identita vah) — jen kód, důvod, lane a incident; text jde do logu', async () => {
    const tajne = `http://mesh-model.instance.internal:8000/v1 sha ${'e'.repeat(64)} kvóta gpu_ms 30000/60s`;
    embedMock.mockRejectedValue(new EmbedDispatchError(503, `lane odmítla embed: LANE_NEDOSTUPNA — ${tajne}`, '', 'LANE_NEDOSTUPNA'));
    const zaznamy: SafeLogEntry[] = [];
    setLogSink((e) => zaznamy.push(e));
    try {
      const r = await hledej();
      const surove = r.body;
      expect(surove).not.toContain('mesh-model');
      expect(surove).not.toMatch(/https?:\/\//);
      expect(surove).not.toMatch(/[0-9a-f]{64}/);
      expect(surove).not.toContain('gpu_ms');
      const telo = r.json().result.structuredContent as Record<string, unknown>;
      expect(Object.keys(telo).sort()).toEqual(['error', 'incident', 'lane', 'reason', 'tool']);
      expect(telo.incident).toMatch(/^[0-9a-f-]{36}$/);
      // Podrobnost je v logu služby pod týmž incidentem (správce ji dohledá).
      const zaznam = zaznamy.find((z) => z.msg === 'knowledge_search.unavailable');
      expect(zaznam?.ctx).toMatchObject({ incident: telo.incident, reason: 'embedding_selhal' });
      expect(String(zaznam?.ctx?.detail)).toContain('mesh-model');
    } finally {
      resetLogSink();
    }
  });

  it('kód lane mimo výčet protokolu se do odpovědi nedostane (jen výčet, nikdy volný text)', async () => {
    embedMock.mockRejectedValue(new EmbedDispatchError(503, 'x', '', 'http://evil.example/' as never));
    const r = await hledej();
    expect(r.json().result.structuredContent).not.toHaveProperty('lane');
  });

  it('cizí příběh (42501) NENÍ nedostupnost — chyba protokolu, žádná data, text chyby jen v logu', async () => {
    embedMock.mockResolvedValue(EMBEDDED);
    rpcUserClaimsMock.mockRejectedValue(new Error('Access denied to story (42501)'));
    const r = await hledej();
    expect(r.json().result).toBeUndefined();
    expect(r.json().error?.message).toMatch(/^MCP tool call failed \(incident [0-9a-f-]{36}\)$/);
  });

  it('⛔ obecná chyba nástroje: volajícímu NIKDY tělo PostgRESTu/DB — jen obecná zpráva + incident; podrobnost v logu', async () => {
    embedMock.mockResolvedValue(EMBEDDED);
    const telo = 'PostgREST rpc/mcp_search_knowledge_v3 failed (500): {"code":"22000","message":"different vector dimensions 1024 and 768","hint":"statement timeout on host db.internal:5432"}';
    rpcUserClaimsMock.mockRejectedValue(new Error(telo));
    const zaznamy: SafeLogEntry[] = [];
    setLogSink((e) => zaznamy.push(e));
    try {
      const r = await hledej();
      expect(r.body).not.toMatch(/PostgREST|vector dimensions|statement timeout|db\.internal|22000/);
      const zprava = String(r.json().error?.message);
      const incident = /incident ([0-9a-f-]{36})/.exec(zprava)?.[1];
      expect(incident).toBeDefined();
      const zaznam = zaznamy.find((z) => z.msg === 'mcp.tool_failed');
      expect(zaznam?.ctx).toMatchObject({ incident, tool: 'search_knowledge_v2' });
      expect(JSON.stringify(zaznam?.err)).toContain('vector dimensions');
    } finally {
      resetLogSink();
    }
  });

  it('neplatné argumenty: jen jména polí ze schématu + incident (ne text zod ani hodnoty)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/mcp',
      headers: { authorization: 'Bearer zprostredkovany', 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search_knowledge_v2', arguments: { query: 'x', limit: 5000 } } },
    });
    const zprava = String(r.json().error?.message);
    expect(zprava).toMatch(/^Invalid tool arguments: limit \(incident [0-9a-f-]{36}\)$/);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('limit search_knowledge_v2 má strop 1–50 (vektorové hledání bez stropu = páka na zátěž DB)', async () => {
    const { KNOWLEDGE_TOOL_INPUTS } = await import('../lib/knowledge-tool-inputs.js');
    const s = KNOWLEDGE_TOOL_INPUTS.search_knowledge_v2;
    expect(s.safeParse({ limit: 50 }).success).toBe(true);
    expect(s.safeParse({ limit: '7' }).success).toBe(true);
    for (const zly of [0, -1, 51, 5000, 2.5]) expect(s.safeParse({ limit: zly }).success, String(zly)).toBe(false);
    expect(s.parse({}).limit).toBe(20);
  });

  it('tools/list: popis nástroje neslibuje textovou zálohu', async () => {
    const r = await app.inject({
      method: 'POST', url: '/mcp',
      headers: { authorization: 'Bearer zprostredkovany', 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    const v2 = (r.json().result.tools as Array<{ name: string; description: string }>).find((t) => t.name === 'search_knowledge_v2');
    expect(v2?.description).toMatch(/no text fallback/);
    expect(v2?.description).not.toMatch(/using text fallback/i);
  });
});

describe('klasifikace chyb (čisté funkce)', () => {
  it('chyba identity se pozná i z těla PostgRESTError', () => {
    const chyba = Object.assign(new Error('PostgREST rpc/x failed (400)'), { body: '{"message":"vektorové hledání nedostupné (embedding_identity_undeclared)"}' });
    expect(nedostupnostZIdentity(chyba)?.reason).toBe('identita_nedeklarovana');
  });
  it('jiná chyba RPC není nedostupnost (null)', () => {
    expect(nedostupnostZIdentity(new Error('Access denied to story x'))).toBeNull();
  });
  it('cokoli z kódování dotazu je nedostupnost — nikdy ne null (selhat nahlas)', () => {
    expect(nedostupnostZEmbeddingu('řetězec').reason).toBe('embedding_selhal');
    expect(nedostupnostZEmbeddingu(new EmbeddingSpaceUnresolvedError('x')).reason).toBe('embedding_backend');
  });
});
