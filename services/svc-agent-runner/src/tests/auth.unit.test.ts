/**
 * Unit tests for svc-agent-runner authentication.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { MockSecurityAuthError, mockJwtVerify, mockVerifyServiceRole } = vi.hoisted(() => {
  class MockSecurityAuthError extends Error {
    constructor(
      message: string,
      public statusCode = 401,
      public reason = 'invalid',
    ) {
      super(message);
      this.name = 'AuthError';
    }
  }

  return {
    MockSecurityAuthError,
    mockJwtVerify: vi.fn(),
    mockVerifyServiceRole: vi.fn(),
  };
});

vi.mock('@aisha/security', () => ({
  AuthError: MockSecurityAuthError,
  createJwtVerifier: vi.fn(() => ({
    verify: mockJwtVerify,
  })),
  verifyServiceRole: mockVerifyServiceRole,
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('../config.js', () => ({
  config: {
    jwksUrl: 'https://auth.example.test/certs',
    keycloakUrl: 'https://auth.example.test',
    keycloakRealm: 'aisha',
    postgrestServiceToken: 'service-token',
  },
}));

describe('svc-agent-runner auth', () => {
  beforeEach(() => {
    mockJwtVerify.mockReset();
    mockVerifyServiceRole.mockReset().mockImplementation((authHeader: string | undefined, expected: string) => {
      if (authHeader === `Bearer ${expected}`) return;
      throw new MockSecurityAuthError('Invalid service role token', 403);
    });
  });

  it('accepts the configured service-role bearer for internal runner calls', async () => {
    const { verifyToken } = await import('../auth.js');

    await expect(verifyToken('Bearer service-token')).resolves.toEqual({
      userId: 'service_role',
      email: '',
      roles: ['service_role', 'agent:run'],
      isServiceRole: true,
    });
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it('falls back to Keycloak JWT verification for normal user tokens', async () => {
    mockJwtVerify.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.test',
      realm_access: { roles: ['agent:run'] },
    });
    const { verifyToken } = await import('../auth.js');

    await expect(verifyToken('Bearer user-jwt')).resolves.toMatchObject({
      userId: 'user-1',
      email: 'user@example.test',
      roles: ['agent:run'],
    });
    expect(mockJwtVerify).toHaveBeenCalledWith('Bearer user-jwt');
  });

  it('requires service-role, agent:run, admin, or staff role', async () => {
    const { requireRunnerOperator } = await import('../auth.js');

    expect(() => requireRunnerOperator({ userId: 'u', email: '', roles: ['member'] })).toThrow(
      'Insufficient agent-runner role',
    );
    expect(() => requireRunnerOperator({ userId: 'u', email: '', roles: ['agent:run'] })).not.toThrow();
    expect(() => requireRunnerOperator({ userId: 'u', email: '', roles: [], isServiceRole: true })).not.toThrow();
  });
});
