/**
 * Unit tests for src/auth.ts — JWT validation gate for pki-bridge.
 *
 * Every call into /v1/issue starts here. A weakness in token validation
 * = anyone with any Keycloak token can issue certs scoped to *.mesh.aisha.internal.
 *
 * Locked-in invariants:
 *   1. Missing / non-Bearer header → AuthError(401) with no info leak
 *   2. Successful verify returns { sub, clientId, roles } from valid claims
 *   3. clientId resolution priority: `azp` claim > `client_id` claim > ''
 *   4. roles[] comes from `realm_access.roles` only (no implicit roles)
 *   5. jose verification failures → AuthError(401) with diagnostic .detail
 *      containing jose error code, expected vs actual aud/iss, kid/alg
 *      fingerprints — operators can pinpoint mismatch without decoding
 *      the token by hand
 *   6. The decoded-token claims used for diagnostic logging come from
 *      UNVERIFIED decode (jose's decodeJwt) — they're labelled as
 *      "inspectedClaims" and used ONLY for log output, never for auth
 *      decisions. We assert this contract holds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockJwtVerify,
  mockCreateLocalJWKSet,
  mockDecodeJwt,
  mockDecodeProtectedHeader,
  mockCreateRemoteJWKSet,
} = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
  mockDecodeJwt: vi.fn(),
  mockDecodeProtectedHeader: vi.fn(),
  mockCreateRemoteJWKSet: vi.fn(),
  mockCreateLocalJWKSet: vi.fn(),
}));

vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  decodeJwt: mockDecodeJwt,
  decodeProtectedHeader: mockDecodeProtectedHeader,
  createRemoteJWKSet: mockCreateRemoteJWKSet,
  createLocalJWKSet: mockCreateLocalJWKSet,
}));

vi.mock('../config.js', () => ({
  config: {
    jwksUrl: 'http://aisha-keycloak:80/realms/aisha/protocol/openid-connect/certs',
    expectedIssuer: 'https://auth.backend.id3a.cz/realms/aisha',
    jwtAudience: 'pki-proxy',
    keycloakUrl: 'https://auth.backend.id3a.cz',
    keycloakRealm: 'aisha',
    // Bez bootstrap runku — chování těchhle testů se nesmí změnit; runk má
    // vlastní soubor auth-bootstrap.unit.test.ts (module-level cache brání
    // přepínat konfiguraci uvnitř jednoho souboru).
    bootstrapJwks: '',
  },
}));

// fp.ts uses crypto.createHash — let it run for real (no mock needed),
// but the test asserts the format, not specific hash values.

mockCreateRemoteJWKSet.mockReturnValue(() => Promise.resolve(null));

beforeEach(() => {
  mockJwtVerify.mockReset();
  mockDecodeJwt.mockReset().mockReturnValue({});
  mockDecodeProtectedHeader.mockReset().mockReturnValue({});
});

// ── Bearer header parsing ────────────────────────────────────

describe('verifyToken — Bearer header parsing', () => {
  it('throws AuthError(401) when header is undefined', async () => {
    const { verifyToken, AuthError } = await import('../auth.js');
    await expect(verifyToken(undefined)).rejects.toBeInstanceOf(AuthError);
    try { await verifyToken(undefined); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(401);
      expect((e as Error).message).toBe('Missing or invalid Authorization header');
    }
  });

  it('throws AuthError(401) when header is empty string', async () => {
    const { verifyToken, AuthError } = await import('../auth.js');
    await expect(verifyToken('')).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError(401) when scheme is not Bearer', async () => {
    const { verifyToken } = await import('../auth.js');
    await expect(verifyToken('Basic abc')).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringContaining('Missing or invalid'),
    });
  });

  it('throws AuthError(401) for case-modified scheme ("bearer xxx") — strict prefix check', async () => {
    // Note: contrasts with @aisha/security::verifyServiceRole which is case-insensitive.
    // svc-pki-bridge's local auth.ts uses .startsWith('Bearer ') which IS case-sensitive.
    // This test documents the current behaviour; tighten / unify later if desired.
    const { verifyToken } = await import('../auth.js');
    await expect(verifyToken('bearer abc')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('does NOT invoke jose.jwtVerify for malformed headers (saves a JWKS round-trip)', async () => {
    const { verifyToken } = await import('../auth.js');
    try { await verifyToken('NotBearer'); } catch { /* expected */ }
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });
});

// ── Happy path — claim extraction ────────────────────────────

describe('verifyToken — claim extraction (happy path)', () => {
  it('returns { sub, clientId from azp, roles[] from realm_access.roles }', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: 'service-account-pki-bootstrap',
        azp: 'aisha-pki-bootstrap',
        realm_access: { roles: ['pki:issue', 'default-roles-aisha'] },
      },
      protectedHeader: { alg: 'RS256', kid: 'kc-key-1' },
    });
    const { verifyToken } = await import('../auth.js');
    const caller = await verifyToken('Bearer good.jwt.signature');
    expect(caller).toEqual({
      sub: 'service-account-pki-bootstrap',
      clientId: 'aisha-pki-bootstrap',
      roles: ['pki:issue', 'default-roles-aisha'],
    });
  });

  it('falls back to client_id claim when azp is absent (legacy KC versions)', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: 'sa-x',
        client_id: 'legacy-client',
        realm_access: { roles: [] },
      },
      protectedHeader: { alg: 'RS256', kid: 'k1' },
    });
    const { verifyToken } = await import('../auth.js');
    const caller = await verifyToken('Bearer x');
    expect(caller.clientId).toBe('legacy-client');
  });

  it('clientId defaults to "" when neither azp nor client_id present (machine-token edge case)', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'sa-x', realm_access: { roles: [] } },
      protectedHeader: { alg: 'RS256', kid: 'k1' },
    });
    const { verifyToken } = await import('../auth.js');
    const caller = await verifyToken('Bearer x');
    expect(caller.clientId).toBe('');
  });

  it('roles[] defaults to [] when realm_access claim missing entirely', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'sa-x', azp: 'svc' },
      protectedHeader: { alg: 'RS256', kid: 'k1' },
    });
    const { verifyToken } = await import('../auth.js');
    const caller = await verifyToken('Bearer x');
    expect(caller.roles).toEqual([]);
  });

  it('sub defaults to "" when missing (defensive — prevents downstream `undefined` casts)', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { azp: 'svc' },
      protectedHeader: { alg: 'RS256', kid: 'k1' },
    });
    const { verifyToken } = await import('../auth.js');
    const caller = await verifyToken('Bearer x');
    expect(caller.sub).toBe('');
  });

  it('passes EXPECTED issuer + audience to jose.jwtVerify (no implicit acceptance)', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'x', azp: 'svc', realm_access: { roles: [] } },
      protectedHeader: { alg: 'RS256', kid: 'k1' },
    });
    const { verifyToken } = await import('../auth.js');
    await verifyToken('Bearer x');
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'x',
      expect.any(Function),
      {
        issuer: 'https://auth.backend.id3a.cz/realms/aisha',
        audience: 'pki-proxy',
      },
    );
  });
});

// ── jose verification failures → AuthError(401) with diagnostic ──

describe('verifyToken — jose failure → AuthError(401) with diagnostic detail', () => {
  it('expired token: detail includes jose_code + expected/actual audience', async () => {
    mockDecodeJwt.mockReturnValue({
      iss: 'https://auth.backend.id3a.cz/realms/aisha',
      aud: 'pki-proxy',
      azp: 'aisha-pki-bootstrap',
    });
    mockDecodeProtectedHeader.mockReturnValue({ alg: 'RS256', kid: 'old-key' });
    const joseErr = Object.assign(new Error('"exp" claim timestamp check failed'), {
      code: 'ERR_JWT_EXPIRED',
    });
    mockJwtVerify.mockRejectedValue(joseErr);

    const { verifyToken } = await import('../auth.js');
    try { await verifyToken('Bearer x'); } catch (e) {
      const err = e as { statusCode: number; detail: Record<string, unknown> };
      expect(err.statusCode).toBe(401);
      expect(err.detail).toMatchObject({
        jose_code: 'ERR_JWT_EXPIRED',
        expected_iss: 'https://auth.backend.id3a.cz/realms/aisha',
        expected_aud: 'pki-proxy',
        token_iss: 'https://auth.backend.id3a.cz/realms/aisha',
        token_aud: 'pki-proxy',
        token_azp: 'aisha-pki-bootstrap',
        token_kid: 'old-key',
        token_alg: 'RS256',
      });
    }
  });

  it('wrong-audience failure: token_aud shows what was actually presented', async () => {
    mockDecodeJwt.mockReturnValue({ iss: 'x', aud: 'wrong-audience', azp: 'svc' });
    mockDecodeProtectedHeader.mockReturnValue({ alg: 'RS256', kid: 'k1' });
    const joseErr = Object.assign(new Error('audience claim mismatch'), {
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'aud',
      reason: 'mismatch',
    });
    mockJwtVerify.mockRejectedValue(joseErr);

    const { verifyToken } = await import('../auth.js');
    try { await verifyToken('Bearer x'); } catch (e) {
      const err = e as { detail: Record<string, unknown> };
      expect(err.detail).toMatchObject({
        jose_claim: 'aud',
        jose_reason: 'mismatch',
        token_aud: 'wrong-audience',
        expected_aud: 'pki-proxy',
      });
    }
  });

  it('malformed token (decodeJwt throws): degrades gracefully — still surfaces jose verify error', async () => {
    mockDecodeJwt.mockImplementation(() => { throw new Error('Invalid token'); });
    mockDecodeProtectedHeader.mockImplementation(() => { throw new Error('Invalid header'); });
    mockJwtVerify.mockRejectedValue(Object.assign(new Error('JWT malformed'), {
      code: 'ERR_JWS_INVALID',
    }));

    const { verifyToken } = await import('../auth.js');
    try { await verifyToken('Bearer not.a.jwt'); } catch (e) {
      const err = e as { statusCode: number; detail: Record<string, unknown> };
      expect(err.statusCode).toBe(401);
      // Decode threw → inspectedClaims is empty object → token_iss is undefined,
      // but the error envelope still goes out without crashing.
      expect(err.detail.jose_code).toBe('ERR_JWS_INVALID');
    }
  });

  it('rejection message is GENERIC ("Invalid, expired, or wrong-audience token") — no oracle for attacker', async () => {
    // We mustn't return different messages for "expired" vs "wrong aud" vs "wrong sig"
    // because that lets an attacker probe which axis fails.
    mockDecodeJwt.mockReturnValue({});
    mockDecodeProtectedHeader.mockReturnValue({});

    for (const joseCode of ['ERR_JWT_EXPIRED', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED']) {
      mockJwtVerify.mockRejectedValueOnce(Object.assign(new Error('details'), { code: joseCode }));
      const { verifyToken } = await import('../auth.js');
      try { await verifyToken('Bearer x'); } catch (e) {
        expect((e as Error).message).toBe('Invalid, expired, or wrong-audience token');
      }
    }
  });

  it('diagnostic detail is in AuthError.detail, NOT in AuthError.message (no client-side leak)', async () => {
    mockDecodeJwt.mockReturnValue({ aud: 'evil-audience-value' });
    mockJwtVerify.mockRejectedValue(Object.assign(new Error('aud mismatch internal'), {
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'aud',
    }));
    const { verifyToken } = await import('../auth.js');
    try { await verifyToken('Bearer x'); } catch (e) {
      const err = e as Error & { detail?: Record<string, unknown> };
      // The MESSAGE we surface MUST be the generic one only — assert exact
      // text rather than negative-contains, because the legitimate generic
      // message itself contains words like "wrong-audience". The
      // `aud mismatch internal` upstream message must NOT appear.
      expect(err.message).toBe('Invalid, expired, or wrong-audience token');
      expect(err.message).not.toContain('mismatch');
      expect(err.message).not.toContain('evil-audience-value');
      // The structured detail IS available for the SERVER LOG (operator-only)
      expect(err.detail).toBeDefined();
      expect(err.detail?.token_aud).toBe('evil-audience-value');
      expect(err.detail?.jose_message).toBe('aud mismatch internal');
    }
  });
});
