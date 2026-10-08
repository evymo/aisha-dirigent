/**
 * Unit tests for svc-mcp-knowledge auth helpers.
 *
 * svc-mcp-knowledge surfaces RAG queries to AISHA's MCP layer.
 * Token roles + scopes determine which knowledge bases the caller can
 * read. A bug in role/scope collection = privilege escalation.
 *
 * Focus on the PURE helpers: asStringArray / collectRoles / collectScopes /
 * isAllowedClient. The full verifyToken is tested via integration paths.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aisha/security', () => ({
  createJwtVerifier: () => ({ verify: vi.fn() }),
  AuthError: class extends Error { statusCode = 401; },
  verifyServiceRole: vi.fn(),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('../config.js', () => ({
  config: {
    jwksUrl: 'http://kc/jwks',
    kcIssuer: 'http://kc/realms/aisha',
    kcAllowedClients: ['aisha-mcp', 'aisha-cli'],
  },
}));

// The helpers are NOT exported — we test through the module's public surface.
// auth.ts only exports verifyToken + AuthError. Since we mock @aisha/security's
// JWT verifier, we can drive the verifyToken flow with synthetic payloads
// and assert that the role/scope/client-allowlist logic does the right
// thing without depending on real jose verification.

describe('auth.ts — verifyToken role/scope/client extraction', () => {
  async function setupWithVerifierResult(
    payload: Record<string, unknown>,
    kcAllowedClients: string[] = ['aisha-mcp', 'aisha-cli'],
  ) {
    vi.resetModules();
    const mockVerify = vi.fn().mockResolvedValue(payload);
    vi.doMock('@aisha/security', () => ({
      createJwtVerifier: () => ({ verify: mockVerify }),
      AuthError: class extends Error { statusCode = 401; },
      verifyServiceRole: vi.fn(),
    }));
    vi.doMock('../config.js', () => ({
      config: {
        jwksUrl: 'http://kc/jwks',
        kcIssuer: 'http://kc/realms/aisha',
        kcAllowedClients,
      },
    }));
    const mod = await import('../auth.js');
    return mod;
  }

  it('returns userId + email from sub + email claims', async () => {
    const { verifyToken } = await setupWithVerifierResult({
      sub: 'user-abc', email: 'u@example.test', azp: 'aisha-mcp',
    });
    const out = await verifyToken('Bearer t');
    expect(out.userId).toBe('user-abc');
    expect(out.email).toBe('u@example.test');
  });

  it('roles[]: collects from realm_access.roles, resource_access.<c>.roles, AND root roles claim', async () => {
    const { verifyToken } = await setupWithVerifierResult({
      sub: 'u', azp: 'aisha-mcp',
      realm_access: { roles: ['user', 'patient'] },
      resource_access: {
        'aisha-mcp': { roles: ['mcp:read'] },
        'other': { roles: ['other:write'] },
      },
      roles: ['root-role'], // legacy top-level roles claim
    });
    const out = await verifyToken('Bearer t');
    expect(out.roles).toEqual(expect.arrayContaining(['user', 'patient', 'mcp:read', 'other:write', 'root-role']));
    // Deduplication: no duplicate entries
    expect(new Set(out.roles).size).toBe(out.roles.length);
  });

  it('roles[]: defensive against non-string entries in claim arrays', async () => {
    const { verifyToken } = await setupWithVerifierResult({
      sub: 'u', azp: 'aisha-mcp',
      realm_access: { roles: ['user', 42, null, undefined, 'admin'] },
    });
    const out = await verifyToken('Bearer t');
    expect(out.roles).toEqual(expect.arrayContaining(['user', 'admin']));
    // No `42`, `null`, `undefined` in roles
    for (const role of out.roles) expect(typeof role).toBe('string');
  });

  it('scopes[]: space-separated OAuth `scope` claim is parsed correctly', async () => {
    const { verifyToken } = await setupWithVerifierResult({
      sub: 'u', azp: 'aisha-mcp',
      scope: 'openid profile mcp:read mcp:list',
    });
    const out = await verifyToken('Bearer t');
    expect(out.scopes).toEqual(expect.arrayContaining(['openid', 'profile', 'mcp:read', 'mcp:list']));
  });

  it('scopes[]: handles array `scp` claim (RFC 9068 / non-OIDC)', async () => {
    const { verifyToken } = await setupWithVerifierResult({
      sub: 'u', azp: 'aisha-mcp',
      scp: ['scope-a', 'scope-b'],
    });
    const out = await verifyToken('Bearer t');
    expect(out.scopes).toEqual(expect.arrayContaining(['scope-a', 'scope-b']));
  });

  it('rejects token from non-allowed client (azp not in kcAllowedClients)', async () => {
    const { verifyToken, AuthError } = await setupWithVerifierResult({
      sub: 'u', azp: 'totally-evil-client',
    });
    await expect(verifyToken('Bearer t')).rejects.toBeInstanceOf(AuthError);
  });

  it('accepts token where azp matches kcAllowedClients', async () => {
    const { verifyToken } = await setupWithVerifierResult({
      sub: 'u', azp: 'aisha-mcp',
    });
    const out = await verifyToken('Bearer t');
    expect(out.userId).toBe('u');
  });

  it('accepts token where aud (NOT azp) matches kcAllowedClients (server-to-server pattern)', async () => {
    const { verifyToken } = await setupWithVerifierResult({
      sub: 'u', aud: ['aisha-cli'], azp: 'unknown-azp',
    });
    const out = await verifyToken('Bearer t');
    expect(out.userId).toBe('u');
  });

  // ⛔ Do 2026-10-04 prázdný seznam pouštěl KAŽDÉHO klienta realmu. Prázdný seznam = nikdo.
  describe('prázdný seznam povolených klientů = nikdo', () => {
    const token = { sub: 'u', azp: 'aisha-mcp', aud: ['aisha-cli'] };

    it('jinak platný token dostane 403 — ani `azp`, ani `aud` nepomůže', async () => {
      const { verifyToken } = await setupWithVerifierResult(token, []);
      await expect(verifyToken('Bearer t')).rejects.toMatchObject({
        name: 'AuthError',
        statusCode: 403,
        message: 'Keycloak client not allowed',
      });
    });

    // Kotva: týž token projde, jakmile seznam jeho klienta nese — 403 výš je tedy seznamem, ne tokenem.
    it.each([
      ['podle azp', ['aisha-mcp']],
      ['podle aud', ['aisha-cli']],
    ])('kotva: týž token s neprázdným seznamem projde (%s)', async (_popis, seznam) => {
      const { verifyToken } = await setupWithVerifierResult(token, seznam);
      await expect(verifyToken('Bearer t')).resolves.toMatchObject({ userId: 'u' });
    });
  });
});
