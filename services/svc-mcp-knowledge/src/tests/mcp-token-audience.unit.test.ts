/**
 * Token z IDE patří jen serveru MCP (mcp-zdroj.ts, revize Guru 2026-10-07).
 *
 * Měří se nad skutečným auth.ts (Keycloak ověření je atrapa, rozhoduje se o claims):
 *   1. `/mcp` token Keycloaku BEZ audience serveru MCP odmítne (403) — i od povoleného klienta;
 *   2. s audience projde a role z tokenu zůstanou: admin nástroje adminovi zůstanou
 *      (pojistka proti fullScopeAllowed=false bez scope mappings: role by z tokenu zmizely);
 *   3. mediovaný token chatu (HS256) audience Keycloaku nepotřebuje;
 *   4. ostatní routy služby (verifyToken) token klienta MCP odmítnou, token webu přijmou.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

const kcVerifyMock = vi.hoisted(() => vi.fn());
const TAJEMSTVI = 'tajemstvi-mediatoru-pro-test-0123456789abcdef';

vi.mock('@aisha/security', () => ({
  createJwtVerifier: () => ({ verify: kcVerifyMock }),
  AuthError: class extends Error { statusCode: number; constructor(s: number, m: string) { super(m); this.statusCode = s; } },
  verifyServiceRole: vi.fn(),
}));
vi.mock('../config.js', () => ({
  config: {
    jwksUrl: 'http://kc/jwks', kcIssuer: 'http://kc/realms/aisha',
    kcAllowedClients: ['aisha-app', 'aisha-mcp-client'], postgrestJwtSecret: 'tajemstvi-mediatoru-pro-test-0123456789abcdef',
  },
}));
vi.mock('../postgrest.js', () => ({ rpcService: vi.fn(), rpcUserClaims: vi.fn(), rpcUser: vi.fn() }));

import { verifyMcpToken, verifyToken, isAdminOrStaff, AuthError } from '../auth.js';
import { AUDIENCE_SERVERU_ZNALOSTI, KLIENT_MCP } from '../mcp-zdroj.js';

const kod = async (p: Promise<unknown>) => {
  try { await p; return 0; } catch (e) { return e instanceof AuthError ? e.statusCode : -1; }
};

describe('token z IDE patří jen serveru MCP', () => {
  beforeEach(() => kcVerifyMock.mockReset());

  it('kotva: hodnoty modulu jsou ty, které deklaruje realm (brána mcp-token-patri-jen-serveru-mcp)', () => {
    expect(AUDIENCE_SERVERU_ZNALOSTI).toBe('aisha-mcp-knowledge');
    expect(KLIENT_MCP).toBe('aisha-mcp-client');
  });

  it('/mcp: token povoleného klienta BEZ audience serveru MCP = 403', async () => {
    kcVerifyMock.mockResolvedValue({ sub: 'u1', azp: 'aisha-app', aud: ['account'] });
    expect(await kod(verifyMcpToken('Bearer a.b.c'))).toBe(403);
    kcVerifyMock.mockResolvedValue({ sub: 'u1', azp: KLIENT_MCP });
    expect(await kod(verifyMcpToken('Bearer a.b.c')), 'ani klient MCP bez audience').toBe(403);
  });

  it('/mcp: s audience projde a admin role zůstane (admin nástroje adminovi zůstanou)', async () => {
    kcVerifyMock.mockResolvedValue({ sub: 'u-admin', azp: KLIENT_MCP, aud: AUDIENCE_SERVERU_ZNALOSTI, roles: ['admin'] });
    const u = await verifyMcpToken('Bearer a.b.c');
    expect(u.userId).toBe('u-admin');
    expect(isAdminOrStaff(u)).toBe(true);
  });

  it('/mcp: mediovaný token chatu audience Keycloaku nepotřebuje', async () => {
    const token = await new SignJWT({ sub: 'u-chat', role: 'authenticated', token_use: 'omni-mcp-mediation' })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(new TextEncoder().encode(TAJEMSTVI));
    const u = await verifyMcpToken(`Bearer ${token}`);
    expect(u.userId).toBe('u-chat');
    expect(kcVerifyMock).not.toHaveBeenCalled();
  });

  it('ostatní routy: token klienta MCP 403 (i s audience), token webu projde', async () => {
    kcVerifyMock.mockResolvedValue({ sub: 'u1', azp: KLIENT_MCP, aud: [AUDIENCE_SERVERU_ZNALOSTI] });
    expect(await kod(verifyToken('Bearer a.b.c'))).toBe(403);
    kcVerifyMock.mockResolvedValue({ sub: 'u1', azp: 'aisha-app' });
    expect((await verifyToken('Bearer a.b.c')).userId).toBe('u1');
  });
});
