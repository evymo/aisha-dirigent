/**
 * Životní cyklus protokolu MCP na POST/GET/DELETE /mcp.
 *
 * ⛔ NAMĚŘENO 2026-09-14: route znala jen `tools/list` a `tools/call`; na
 * `initialize` vracela -32601 a GET odpovídal JSON „sondou". Standardní klient
 * MCP začíná `initialize`, takže nativní MCP Client Tool v n8n se nepřipojil.
 *
 * Tvar požadavků odpovídá klientovi @modelcontextprotocol/sdk 1.20.0, který
 * používá n8n 1.123 (ověřeno ve zdroji SDK):
 *   - initialize s `protocolVersion: 2025-06-18`; odpověď přijme jen z verzí
 *     ['2025-06-18','2025-03-26','2024-11-05','2024-10-07'], jinak vyhodí
 *   - pak `notifications/initialized` (bez id) → čeká 202 bez těla
 *   - pak GET se `accept: text/event-stream` → 405 bere jako „bez SSE"
 *   - další požadavky s hlavičkou `mcp-protocol-version`
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let Fastify: typeof import('fastify').default | null = null;
try {
  Fastify = (await import('fastify')).default;
} catch {
  Fastify = null;
}
const describeIfFastify = Fastify ? describe : describe.skip;

const MockAuthError = vi.hoisted(
  () =>
    class MockAuthError extends Error {
      statusCode: number;
      constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
      }
    },
);
const verifyTokenMock = vi.hoisted(() => vi.fn());
const isAdminOrStaffMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('../auth.js', () => ({
  verifyToken: verifyTokenMock,
  verifyMcpToken: verifyTokenMock,
  isAdminOrStaff: isAdminOrStaffMock,
  AuthError: MockAuthError,
}));
vi.mock('../postgrest.js', () => ({ rpcService: vi.fn(), rpcUserClaims: vi.fn() }));
vi.mock('../lib/aitg-tools.js', () => ({ aitgDispatch: vi.fn() }));
vi.mock('../lib/flowboard-tools.js', () => ({ flowboardDispatch: vi.fn() }));
vi.mock('../lib/embed-query-in-space.js', () => ({ embedQueryForProfile: vi.fn() }));

import { mcpRoutes, PODPOROVANE_VERZE_PROTOKOLU } from '../routes/mcp.js';

/** Verze, které klient SDK 1.20.0 od serveru přijme (types.ts SUPPORTED_PROTOCOL_VERSIONS). */
const KLIENT_PRIJME = ['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];

describeIfFastify('MCP životní cyklus (/mcp)', () => {
  let app: import('fastify').FastifyInstance;

  beforeEach(async () => {
    verifyTokenMock.mockReset();
    verifyTokenMock.mockResolvedValue({ sub: 'agent-1', roles: ['authenticated'], claims: { sub: 'agent-1' } });
    app = Fastify!();
    await app.register(mcpRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      payload: payload as object,
    });

  it('initialize vrátí verzi, kterou klient přijme, capabilities.tools a serverInfo', async () => {
    const r = await post({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'n8n', version: '1.123.0' } },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.id).toBe(0);
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(KLIENT_PRIJME).toContain(body.result.protocolVersion);
    expect(body.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(body.result.serverInfo.name).toBe('aisha-mcp-knowledge-server');
  });

  it('neznámou verzi klienta server nepřevezme — nabídne svou nejnovější', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    expect(r.json().result.protocolVersion).toBe(PODPOROVANE_VERZE_PROTOKOLU[0]);
  });

  it('notifications/initialized (bez id) → 202 bez těla', async () => {
    const r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(r.statusCode).toBe(202);
    expect(r.body).toBe('');
  });

  it('odpověď klienta na požadavek serveru (result bez method) → 202', async () => {
    const r = await post({ jsonrpc: '2.0', id: 7, result: {} });
    expect(r.statusCode).toBe(202);
  });

  it('ping → prázdný result', async () => {
    const r = await post({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(r.json()).toEqual({ jsonrpc: '2.0', result: {}, id: 2 });
  });

  it('GET i DELETE /mcp → 405 s allow: POST (server nenabízí SSE ani relace)', async () => {
    for (const method of ['GET', 'DELETE'] as const) {
      const r = await app.inject({ method, url: '/mcp', headers: { accept: 'text/event-stream', authorization: 'Bearer t' } });
      expect(r.statusCode, method).toBe(405);
      expect(r.headers.allow).toBe('POST');
    }
  });

  it('podporovaná mcp-protocol-version projde, nepodporovaná → 400', async () => {
    const ok = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'mcp-protocol-version': '2025-06-18' });
    expect(ok.statusCode).toBe(200);
    expect(Array.isArray(ok.json().result.tools)).toBe(true);

    const spatne = await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { 'mcp-protocol-version': '1999-01-01' });
    expect(spatne.statusCode).toBe(400);
  });

  it('initialize bez platného tokenu → 401 (handshake není cesta kolem ověření)', async () => {
    verifyTokenMock.mockRejectedValueOnce(new MockAuthError(401, 'Missing bearer token'));
    const r = await post({ jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(r.statusCode).toBe(401);
  });

  it('neznámá metoda s id → -32601, ne tiché 202', async () => {
    const r = await post({ jsonrpc: '2.0', id: 6, method: 'resources/list' });
    expect(r.json().error.code).toBe(-32601);
  });
});
