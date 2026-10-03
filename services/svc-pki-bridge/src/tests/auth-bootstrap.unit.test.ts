/**
 * Bootstrap JWKS rung — verification against the DELIVERED realm keys when the
 * live JWKS is unreachable.
 *
 * WHY THIS EXISTS (multi-node bootstrap cycle, 2026-08-05): verifying a token
 * needs the JWKS; reaching KC from another node needs the mesh; the mesh needs
 * a cert from /v1/issue; /v1/issue needs a verified token. The delivered keys
 * break the cycle without a second trust anchor — same issuer, same iss+aud
 * checks, only the transport differs (the deploy pipeline instead of the
 * network).
 *
 * Locked-in invariants:
 *   1. Live fetch fails (network class) + bootstrap present → the SAME token
 *      is verified against the delivered set and the caller is returned.
 *   2. Claim/signature failures NEVER fall back — the keys worked, the token
 *      is bad. Exactly one jwtVerify call.
 *   3. Token that fails against the bootstrap set too → AuthError 401, never
 *      an unwrapped exception (a bad token must not become a 500).
 *   4. Verification options of the bootstrap path carry the SAME issuer and
 *      audience as the live path — the rung must not be a weaker check.
 *
 * Separate file on purpose: the parsed bootstrap set is cached at module
 * level (delivery happens between waves, not between requests), so a file
 * that also tests the empty-bootstrap behaviour could not use it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockJwtVerify,
  mockDecodeJwt,
  mockDecodeProtectedHeader,
  mockCreateRemoteJWKSet,
  mockCreateLocalJWKSet,
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

const BOOTSTRAP_JWKS = { keys: [{ kty: 'RSA', kid: 'delivered-1', n: 'x', e: 'AQAB' }] };

vi.mock('../config.js', () => ({
  config: {
    jwksUrl: 'http://aisha-keycloak:80/realms/aisha/protocol/openid-connect/certs',
    expectedIssuer: 'https://auth.backend.example.com/realms/aisha',
    jwtAudience: 'pki-proxy',
    keycloakUrl: 'https://auth.backend.example.com',
    keycloakRealm: 'aisha',
    bootstrapJwks: JSON.stringify({
      keys: [{ kty: 'RSA', kid: 'delivered-1', n: 'x', e: 'AQAB' }],
    }),
  },
}));

const REMOTE_SET = Symbol('remote-set');
const LOCAL_SET = Symbol('local-set');
mockCreateRemoteJWKSet.mockReturnValue(REMOTE_SET as never);
mockCreateLocalJWKSet.mockReturnValue(LOCAL_SET as never);

function networkError(): Error {
  // jose wraps fetch failures without a JWT/JWS error code — the class the
  // rung is FOR. (A TypeError from fetch has no `code` at all.)
  return new TypeError('fetch failed: getaddrinfo ENOTFOUND aisha-keycloak');
}

function claimError(code: string): Error {
  const e = new Error(code) as Error & { code: string };
  e.code = code;
  return e;
}

const GOOD_PAYLOAD = {
  sub: 'user-1',
  azp: 'aisha-pki-bootstrap',
  realm_access: { roles: ['pki-issue'] },
};

beforeEach(() => {
  mockJwtVerify.mockReset();
  mockDecodeJwt.mockReset().mockReturnValue({});
  mockDecodeProtectedHeader.mockReset().mockReturnValue({});
});

describe('bootstrap JWKS rung', () => {
  it('live fetch fails → the DELIVERED set verifies the same token', async () => {
    const { verifyToken } = await import('../auth.js');
    mockJwtVerify
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ payload: GOOD_PAYLOAD } as never);

    const caller = await verifyToken('Bearer some.token.here');
    expect(caller).toEqual({ sub: 'user-1', clientId: 'aisha-pki-bootstrap', roles: ['pki-issue'] });

    // The delivered set was parsed from config and used for the retry…
    expect(mockCreateLocalJWKSet).toHaveBeenCalledWith(BOOTSTRAP_JWKS);
    expect(mockJwtVerify).toHaveBeenCalledTimes(2);
    expect(mockJwtVerify.mock.calls[1][1]).toBe(LOCAL_SET);
    // …with the SAME issuer + audience — the rung is not a weaker check.
    expect(mockJwtVerify.mock.calls[1][2]).toEqual({
      issuer: 'https://auth.backend.example.com/realms/aisha',
      audience: 'pki-proxy',
    });
  });

  it.each(['ERR_JWT_EXPIRED', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'])(
    '%s never falls back — the keys worked, the token is bad',
    async (code) => {
      const { verifyToken, AuthError } = await import('../auth.js');
      mockJwtVerify.mockRejectedValueOnce(claimError(code));

      await expect(verifyToken('Bearer bad.token.here')).rejects.toBeInstanceOf(AuthError);
      expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    },
  );

  it('token bad against the bootstrap set too → AuthError 401, not a crash', async () => {
    const { verifyToken, AuthError } = await import('../auth.js');
    mockJwtVerify
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(claimError('ERR_JWS_SIGNATURE_VERIFICATION_FAILED'));

    const err = await verifyToken('Bearer forged.token.here').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as InstanceType<typeof AuthError>).statusCode).toBe(401);
  });
});
