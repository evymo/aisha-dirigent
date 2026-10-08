/**
 * `mcp_` PAT na /mcp — ověření identity (auth.ts verifyMcpToken / verifyMcpPat).
 *
 * ⛔ NAMĚŘENO 2026-09-14: /mcp přijímal jen Keycloak JWT (300 s) nebo mediovaný
 * token — žádný statický credential pro n8n agenty. PAT lane staví na
 * `validate_mcp_token` (mcp_auth_tokens). Kódy dohodnuté s relací aplatform-93:
 * 401 = neplatný/expirovaný/neověřitelný/bez vlastníka; 403 = platný, ale bez
 * allowlistu (na /mcp by jinak každý neomezený token otevřel všechny nástroje).
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcServiceMock = vi.hoisted(() => vi.fn());
const kcVerifyMock = vi.hoisted(() => vi.fn());

vi.mock('@aisha/security', () => ({
  createJwtVerifier: () => ({ verify: kcVerifyMock }),
  AuthError: class extends Error { statusCode = 401; },
  verifyServiceRole: vi.fn(),
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));
vi.mock('../config.js', () => ({
  // Prázdný seznam klientů = nikdo (auth.ts isAllowedClient) — test si svého klienta deklaruje.
  config: { jwksUrl: 'http://kc/jwks', kcIssuer: 'http://kc/realms/aisha', kcAllowedClients: ['aisha-app'], postgrestJwtSecret: '' },
}));
vi.mock('../postgrest.js', () => ({ rpcService: rpcServiceMock, rpcUserClaims: vi.fn(), rpcUser: vi.fn() }));

import { verifyMcpToken, AuthError } from '../auth.js';

const TOKEN = 'mcp_' + 'a'.repeat(64);
const platny = (navic: Record<string, unknown> = {}) => ({
  valid: true, user_id: 'u-agent', scoped_to_story_id: 'story-1', allowed_tools: ['search_knowledge'], denied_tools: [], ...navic,
});

async function kodChyby(p: Promise<unknown>): Promise<number | 'ok'> {
  try { await p; return 'ok'; } catch (e) { return e instanceof AuthError ? e.statusCode : -1; }
}

describe('verifyMcpToken — mcp_ PAT', () => {
  beforeEach(() => { rpcServiceMock.mockReset(); kcVerifyMock.mockReset(); });

  it('platný token s allowlistem → identita vlastníka, role authenticated, story z tokenu', async () => {
    rpcServiceMock.mockResolvedValueOnce(platny({ denied_tools: ['admin_health_check'] }));
    const u = await verifyMcpToken(`Bearer ${TOKEN}`);
    expect(rpcServiceMock).toHaveBeenCalledWith('validate_mcp_token', {
      p_token_hash: createHash('sha256').update(TOKEN).digest('hex'), p_tool_name: null, p_project_id: null,
    });
    expect(u.userId).toBe('u-agent');
    expect(u.roles).toEqual(['authenticated']);
    expect(u.claims).toMatchObject({ sub: 'u-agent', role: 'authenticated', story_id: 'story-1' });
    expect(u.pat).toEqual({ allowedTools: ['search_knowledge'], deniedTools: ['admin_health_check'] });
    expect(kcVerifyMock, 'PAT nesmí jít do Keycloak ověření').not.toHaveBeenCalled();
  });

  it.each([
    ['neplatný / expirovaný', { valid: false, reason: 'token_not_found_or_expired' }],
    ['bez vlastníka (user_id null)', platny({ user_id: null })],
  ])('%s → 401', async (_, odpoved) => {
    rpcServiceMock.mockResolvedValueOnce(odpoved);
    expect(await kodChyby(verifyMcpToken(`Bearer ${TOKEN}`))).toBe(401);
  });

  it('neověřitelný (PostgREST selže) → 401, ne 500', async () => {
    rpcServiceMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await kodChyby(verifyMcpToken(`Bearer ${TOKEN}`))).toBe(401);
  });

  it('platný token BEZ allowlistu → 403 (SQL „prázdné = vše" na /mcp neplatí)', async () => {
    rpcServiceMock.mockResolvedValueOnce(platny({ allowed_tools: [] }));
    expect(await kodChyby(verifyMcpToken(`Bearer ${TOKEN}`))).toBe(403);
  });

  it('jiný než mcp_ token jde do Keycloak ověření (token vydaný pro server MCP)', async () => {
    kcVerifyMock.mockResolvedValueOnce({ sub: 'kc-user', azp: 'aisha-app', aud: ['aisha-mcp-knowledge'], realm_access: { roles: ['staff'] } });
    const u = await verifyMcpToken('Bearer a.b.c');
    expect(rpcServiceMock).not.toHaveBeenCalled();
    expect(u.userId).toBe('kc-user');
    expect(u.pat).toBeUndefined();
  });
});
