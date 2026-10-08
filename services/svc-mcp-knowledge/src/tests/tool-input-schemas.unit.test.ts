/**
 * Rozhraní nástrojů MCP z jednoho zdroje (zod schéma) — měřeno přímo nad tools/list a tools/call.
 *
 * ⛔ NAMĚŘENO 2026-10-01: tools/list nabízel u všech nástrojů prázdné schéma, model jména
 * argumentů jen hádal. Teď totéž schéma validuje vstup a dává inputSchema.
 *
 * Co se tu měří:
 *   1. každý nástroj v tools/list má objektové schéma a KAŽDÁ vlastnost popis ← kontrolní vzorek
 *   2. výchozí hodnoty jako dřív (prázdný dotaz, limit 20, prázdné tagy, AI instrukce zapnuté)
 *   3. číslo z textu se převede („5“ → 5), jak to dnešní klienti posílají
 *   4. neplatný tvar = chyba nástroje a RPC se nevolá; neznámé klíče se ignorují
 *   5. aliasy argumentů platí dál (rule_slug → slug)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const MockAuthError = vi.hoisted(() => class extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; }
});
const identitaMock = vi.hoisted(() => vi.fn());
const rpcServiceMock = vi.hoisted(() => vi.fn(async () => [{ ok: true }]));

vi.mock('../auth.js', () => ({
  verifyMcpToken: identitaMock,
  verifyToken: vi.fn(),
  isAdminOrStaff: (u: { roles: string[] }) => u.roles.includes('admin') || u.roles.includes('staff'),
  AuthError: MockAuthError,
}));
vi.mock('../postgrest.js', () => ({ rpcService: rpcServiceMock, rpcUserClaims: vi.fn(async () => []) }));
vi.mock('../lib/aitg-tools.js', () => ({ aitgDispatch: vi.fn() }));
vi.mock('../lib/flowboard-tools.js', () => ({ flowboardDispatch: vi.fn() }));
vi.mock('../lib/embed-query-in-space.js', () => ({ embedQueryForProfile: vi.fn() }));

import { mcpRoutes } from '../routes/mcp.js';

const admin = { userId: 'u-admin', roles: ['admin'], scopes: [], claims: { sub: 'u-admin' } };

describe('rozhraní nástrojů MCP ze zod schématu', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    identitaMock.mockReset(); identitaMock.mockResolvedValue(admin);
    rpcServiceMock.mockClear();
    app = Fastify(); await app.register(mcpRoutes); await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const rpc = (payload: object) => app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer x', 'content-type': 'application/json' }, payload });
  const zavolej = (name: string, args: object) => rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const rpcParams = () => (rpcServiceMock.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];

  it('každý nástroj má objektové schéma a každá vlastnost popis (kontrolní vzorek)', async () => {
    const tools = (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json().result.tools as Array<{ name: string; inputSchema: Record<string, unknown> }>;
    expect(tools.length).toBeGreaterThanOrEqual(40);
    const bezPopisu: string[] = [];
    for (const t of tools) {
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(t.inputSchema.$schema, `${t.name}: $schema do MCP nepatří`).toBeUndefined();
      for (const [k, v] of Object.entries((t.inputSchema.properties ?? {}) as Record<string, { description?: string }>)) {
        if (!v.description?.trim()) bezPopisu.push(`${t.name}.${k}`);
      }
    }
    expect(bezPopisu, 'vlastnost bez popisu — přidej .describe()').toEqual([]);
    const sk = tools.find((t) => t.name === 'search_knowledge')!.inputSchema;
    expect(Object.keys(sk.properties as object)).toEqual(expect.arrayContaining(['query', 'limit', 'context_tags']));
  });

  it('výchozí hodnoty jako dřív', async () => {
    await zavolej('search_knowledge', {});
    expect((rpcServiceMock.mock.calls[0] as unknown as [string])[0]).toBe('mcp_search_knowledge');
    // Publikum je `sub` ověřeného tokenu (main 2026-10-04: pravidla podle viditelnosti pro toho,
    // kdo se ptá) — nikdy argument klienta.
    expect(rpcParams()).toEqual({
      p_audience_user_id: 'u-admin',
      p_category: null, p_context_tags: [], p_expertise_slug: null,
      p_include_ai_instructions: true, p_limit: 20, p_query: '',
    });
  });

  it('číslo z textu se převede', async () => {
    await zavolej('search_knowledge', { query: 'spánek', limit: '5' });
    expect(rpcParams()).toMatchObject({ p_query: 'spánek', p_limit: 5 });
  });

  it('neplatný tvar = chyba nástroje, RPC se nevolá; neznámé klíče se ignorují', async () => {
    const spatne = await zavolej('search_knowledge', { limit: 'hodně' });
    expect(spatne.json().error).toBeTruthy();
    expect(rpcServiceMock).not.toHaveBeenCalled();
    await zavolej('search_knowledge', { query: 'x', _meta: { progressToken: 1 } });
    expect(rpcParams()).toMatchObject({ p_query: 'x' });
  });

  it('aliasy argumentů platí dál', async () => {
    await zavolej('get_expert_rule', { rule_slug: 'rpc-only' });
    expect(rpcParams()).toEqual({ p_audience_user_id: 'u-admin', p_rule_slug: 'rpc-only' });
  });
});
