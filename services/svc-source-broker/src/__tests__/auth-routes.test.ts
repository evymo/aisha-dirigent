/**
 * auth-routes.test.ts — /auth/source/login route security (audit follow-up)
 *
 * The coverage audit found registerAuthRoutes had NO route-level test: the
 * reply-handshake-mismatch refusal (routes/auth.ts ~197-200) and the input/
 * verify failure paths were unasserted, so inverting the handshake check would
 * pass every existing unit test and the happy-path E2E. These tests boot a real
 * Fastify app with the GraphQL client mocked, and pin the SECURITY branches that
 * reject before any DB/provision work:
 *   • missing onboardingToken/code        → 400
 *   • verifyOnboarding fails               → 401
 *   • sourceJwt reply handshake MISMATCH   → 401 (the load-bearing refusal)
 *   • sourceJwt success flag false         → 401
 *
 * The happy 200 path (provision + mint) is covered by the live federation E2E
 * (make aisha-test-federation-container); here we lock the deny side.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// Mock graphql-request: the route does `new GraphQLClient(url).request(QUERY, vars, headers)`.
// We branch on the query text (verifyOnboarding vs sourceJwt) to script responses.
const reqMock = vi.fn();
vi.mock('graphql-request', () => ({
  GraphQLClient: class {
    request(...args: unknown[]) {
      return reqMock(...args);
    }
  },
  gql: (strings: TemplateStringsArray) => strings.join(''),
}));

import { registerAuthRoutes } from '../routes/auth.js';
import type { SourceBrokerConfig } from '../config.js';

const INCOMING = 'OM A HUM VAJRA GURU PADMA SIDDHI HUM'; // the expected reply handshake
const OUTGOING = 'RAM YAM KHAM OM A HUM';

function config(): SourceBrokerConfig {
  return {
    postgrestUrl: 'http://postgrest', postgrestServiceToken: 't', postgresUrl: 'postgres://t',
    keycloakUrl: 'http://k', keycloakRealm: 'aisha', oidcAppClientId: 'aisha-app',
    sourceApiUrl: 'http://source', sourceServiceEmail: '', sourceServicePassword: '',
    sourcePgUrl: 'postgres://s',
    sourceAuthHandshakeOutgoing: OUTGOING, sourceAuthHandshakeIncoming: INCOMING,
    jwtCacheTtlMs: 1, webhookHmacSecret: 's', syncIntervalMs: 1, port: 8090,
    logLevel: 'silent', corsAllowlist: '', rateLimitEnabled: false, devAllowUnauthedSync: false,
    aishaGatewayUrl: 'http://g', aishaGatewayIntranetKey: '', aishaJwtSecret: 'devsecret',
    aishaJwtExpSec: 3600, aishaMemberRole: 'authenticated',
  };
}

// A SourcePgClient stand-in — only used AFTER the handshake passes, so the deny
// tests never reach it.
const fakeSource = {
  connect: async () => {},
  getMemberByEmail: async () => ({ userId: 'u', email: 'm@x', displayName: 'M', language: 'en' }),
} as unknown as Parameters<typeof registerAuthRoutes>[2];

async function appWith() {
  const app = Fastify({ logger: false });
  registerAuthRoutes(app, config(), fakeSource);
  await app.ready();
  return app;
}

const isVerify = (q: unknown) => typeof q === 'string' && q.includes('verifyOnboarding');
const isJwt = (q: unknown) => typeof q === 'string' && q.includes('sourceJwt');

describe('/auth/source/login — deny paths', () => {
  beforeEach(() => reqMock.mockReset());

  it('400 when onboardingToken/code missing', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: '/auth/source/login', payload: { code: 'X' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('401 when verifyOnboarding fails', async () => {
    reqMock.mockImplementation((q) =>
      isVerify(q) ? { verifyOnboarding: { onboarding: null, success: false, error: 'bad code' } } : {}
    );
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/auth/source/login', payload: { onboardingToken: 'ot', code: 'X' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('401 when the sourceJwt REPLY HANDSHAKE does not match (the load-bearing refusal)', async () => {
    reqMock.mockImplementation((q) => {
      if (isVerify(q)) {
        return { verifyOnboarding: { onboarding: { existingUser: { id: 'u', email: 'm@x' } }, success: true, error: null } };
      }
      if (isJwt(q)) {
        // success, but the reply handshake is WRONG — the broker must refuse.
        return { sourceJwt: { jwtSource: { token: 'jwt', authHandshake: 'WRONG MANTRA' }, success: true, error: null } };
      }
      return {};
    });
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/auth/source/login', payload: { onboardingToken: 'ot', code: 'X' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('source_jwt_failed');
    await app.close();
  });

  it('401 when sourceJwt reports failure', async () => {
    reqMock.mockImplementation((q) => {
      if (isVerify(q)) {
        return { verifyOnboarding: { onboarding: { existingUser: { id: 'u', email: 'm@x' } }, success: true, error: null } };
      }
      if (isJwt(q)) return { sourceJwt: { jwtSource: null, success: false, error: 'nope' } };
      return {};
    });
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/auth/source/login', payload: { onboardingToken: 'ot', code: 'X' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
