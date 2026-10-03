/**
 * Unit tests for src/routes/diag.ts — the diagnostic-route auth boundary (M-D6).
 *
 * /diag and /diag/openxpki-state expose secret fingerprints, JWKS/kid state, the
 * rendered RPC HMAC fingerprint, and log tails incl. audit.log (the private-key
 * + secret ACCESS log). They MUST require a valid Keycloak token. /diag/ca-bundle
 * stays anonymous (public trust anchors, cross-stack CA refresh) and lives in
 * server.ts, so it is intentionally out of scope here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';

const { mockVerifyToken, mockGetJwksCacheInfo, AuthError } = vi.hoisted(() => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 401) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
    }
  }
  return { mockVerifyToken: vi.fn(), mockGetJwksCacheInfo: vi.fn(), AuthError };
});

vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
  getJwksCacheInfo: mockGetJwksCacheInfo,
  AuthError,
}));
vi.mock('../fp.js', () => ({ fp: (s: string) => `fp:${(s ?? '').length}` }));
vi.mock('../config.js', () => ({
  config: {
    expectedIssuer: 'https://kc.test/realms/aisha',
    jwtAudience: 'pki-proxy',
    jwksUrl: 'http://kc.test/certs',
    keycloakUrl: 'https://kc.test',
    keycloakInternalUrl: 'http://kc.test',
    openxpkiRpcUrl: 'http://pki-webui/rpc',
    openxpkiRealm: 'orchestration-plane',
    certProfile: 'tls-server',
    keyAlgorithm: 'P-384',
    allowedSanPatterns: ['*.mesh.aisha.internal'],
    openxpkiRpcHmac: 'secret-hmac',
  },
}));

beforeEach(() => {
  mockVerifyToken.mockReset();
  mockGetJwksCacheInfo.mockReset().mockResolvedValue({ kids: ['kid1'], reachable: true });
  // /diag probes OpenXPKI RPC via fetch — stub it to fail fast (no real network, no 5s wait).
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no-net'); }));
});

async function buildApp() {
  const { diagRoutes } = await import('../routes/diag.js');
  const app = Fastify();
  // Mirror server.ts's error handler so a thrown AuthError becomes its statusCode.
  app.setErrorHandler((error: FastifyError, _req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AuthError) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Internal server error' });
  });
  await app.register(diagRoutes);
  return app;
}

describe('routes/diag — M-D6 auth gate', () => {
  it('/diag/openxpki-state → 401 without a Bearer token', async () => {
    mockVerifyToken.mockRejectedValue(new AuthError('Missing or invalid Authorization header', 401));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/diag/openxpki-state' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('/diag/openxpki-state → 200 with a valid token', async () => {
    mockVerifyToken.mockResolvedValue({ sub: 'op-1', clientId: 'aisha-pki-bootstrap' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/diag/openxpki-state',
      headers: { authorization: 'Bearer valid' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalledWith('Bearer valid');
    await app.close();
  });

  it('/diag → 401 without a Bearer token', async () => {
    mockVerifyToken.mockRejectedValue(new AuthError('Missing or invalid Authorization header', 401));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/diag' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('/diag → 200 with a valid token; verifyToken received the raw auth header', async () => {
    mockVerifyToken.mockResolvedValue({ sub: 'op-1' });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/diag', headers: { authorization: 'Bearer valid' } });
    expect(res.statusCode).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalledWith('Bearer valid');
    await app.close();
  });
});
