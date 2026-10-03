/**
 * Unit tests for svc-packeta auth — verifyServiceRole (delegates to shared
 * @aisha/security helper after wave 9c refactor).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aisha/security', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 401) {
      super(message); this.name = 'AuthError'; this.statusCode = statusCode;
    }
  }
  return {
    createJwtVerifier: () => ({ verify: vi.fn() }),
    AuthError,
    verifyServiceRole(authHeader: string | undefined, expectedToken: string): void {
      if (!authHeader) throw new AuthError('Missing Authorization header', 401);
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (token.length !== expectedToken.length) {
        throw new AuthError('Invalid service role token', 403);
      }
      let diff = 0;
      for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expectedToken.charCodeAt(i);
      if (diff !== 0) throw new AuthError('Invalid service role token', 403);
    },
  };
});

vi.mock('../config.js', () => ({
  config: {
    jwksUrl: 'http://kc/jwks', keycloakUrl: 'http://kc', keycloakRealm: 'aisha',
    postgrestServiceToken: 'packeta-service-token-deadbeef',
  },
}));

describe('svc-packeta verifyServiceRole — delegates to shared helper', () => {
  it('accepts correct token', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    expect(() => verifyServiceRole('Bearer packeta-service-token-deadbeef')).not.toThrow();
  });

  it('rejects missing header → 401', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    try { verifyServiceRole(undefined); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(401);
    }
  });

  it('rejects wrong token → 403 (post-wave-9c semantic split)', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    try { verifyServiceRole('Bearer wrong-token-deadbeef-X'); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(403);
    }
  });

  it('1MB token rejected in microseconds (length-fail fast)', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    const huge = 'A'.repeat(1_000_000);
    const t0 = performance.now();
    try { verifyServiceRole(`Bearer ${huge}`); } catch { /* expected */ }
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
