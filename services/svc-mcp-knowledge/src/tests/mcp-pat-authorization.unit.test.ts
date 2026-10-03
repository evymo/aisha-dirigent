/**
 * Allowlist PAT = AUTORIZACE vymáhaná serverem jedním predikátem (canUseTool).
 *
 * Dohodnuto s relací aplatform-93 (2026-09-14): nástroj, který token nesmí,
 * NENÍ v tools/list A jeho tools/call vrátí 403 — i když ho klient zná odjinud.
 * Filtrovaný seznam bez vymáhání při volání není autorizace.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const MockAuthError = vi.hoisted(() => class extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; }
});
const identitaMock = vi.hoisted(() => vi.fn());
const rpcServiceMock = vi.hoisted(() => vi.fn(async () => [{ area: 'x' }]));

vi.mock('../auth.js', () => ({
  verifyMcpToken: identitaMock,
  // /mcp MUSÍ ověřovat přes verifyMcpToken — kdyby route sáhla na verifyToken
  // (bez PAT lane), tenhle mock ji odmítne a testy zčervenají.
  verifyToken: vi.fn(async () => { throw new MockAuthError(401, 'verifyToken PAT nezná'); }),
  isAdminOrStaff: (u: { roles: string[] }) => u.roles.includes('admin') || u.roles.includes('staff'),
  AuthError: MockAuthError,
}));
vi.mock('../postgrest.js', () => ({ rpcService: rpcServiceMock, rpcUserClaims: vi.fn() }));
vi.mock('../lib/aitg-tools.js', () => ({ aitgDispatch: vi.fn() }));
vi.mock('../lib/flowboard-tools.js', () => ({ flowboardDispatch: vi.fn() }));
vi.mock('../lib/embed-query-in-space.js', () => ({ embedQueryForProfile: vi.fn() }));

import { mcpRoutes } from '../routes/mcp.js';

const patAgent = {
  userId: 'u-agent', roles: ['authenticated'], scopes: [], claims: { sub: 'u-agent' },
  pat: { allowedTools: ['get_expertise_areas', 'match_experts'], deniedTools: ['match_experts'] },
};

describe('PAT allowlist na /mcp', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    identitaMock.mockReset(); identitaMock.mockResolvedValue(patAgent); rpcServiceMock.mockClear();
    app = Fastify(); await app.register(mcpRoutes); await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const rpc = (payload: object) => app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer mcp_x', 'content-type': 'application/json' }, payload });

  it('tools/list ukáže jen allowlist mínus denylist', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.json().result.tools.map((t: { name: string }) => t.name)).toEqual(['get_expertise_areas']);
  });

  it('tools/call nástroje MIMO allowlist → 403 a RPC se nezavolá', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_expert_rule', arguments: { slug: 'x' } } });
    expect(r.statusCode).toBe(403);
    expect(rpcServiceMock).not.toHaveBeenCalled();
  });

  it('tools/call nástroje na denylistu (i když je v allowlistu) → 403', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'match_experts', arguments: {} } });
    expect(r.statusCode).toBe(403);
    expect(rpcServiceMock).not.toHaveBeenCalled();
  });

  it('tools/call povoleného nástroje projde', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_expertise_areas', arguments: {} } });
    expect(r.statusCode).toBe(200);
    expect(r.json().result.content[0].type).toBe('text');
    expect(rpcServiceMock).toHaveBeenCalledOnce();
  });

  it('PAT nikdy nedosáhne admin nástroje, ani když ho má v allowlistu', async () => {
    identitaMock.mockResolvedValue({ ...patAgent, pat: { allowedTools: ['admin_health_check'], deniedTools: [] } });
    const list = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    expect(list.json().result.tools).toEqual([]);
    const call = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'admin_health_check', arguments: {} } });
    expect(call.statusCode).toBe(403);
  });
});
