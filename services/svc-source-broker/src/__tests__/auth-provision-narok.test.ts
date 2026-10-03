/**
 * /auth/source/login — zřízení člena běží s NÁROKEM služby.
 *
 * ⛔ Nález 2026-09-15: audience_provision_federated_member zakládá i dvojče přes
 * twin_upsert_entity_audited, jehož stráž čte JWT claims (ne roli spojení).
 * Route claims nenastavovala → stráž odmítla → výjimka spolknutá jako WARNING →
 * člen bez reference `source-federation`. Test pinuje, že na TÉMŽ spojení
 * zazní `SET request.jwt.claims` se service_role DŘÍV než zřízení.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';

const reqMock = vi.fn();
vi.mock('graphql-request', () => ({
  GraphQLClient: class {
    request(...args: unknown[]) {
      return reqMock(...args);
    }
  },
  gql: (strings: TemplateStringsArray) => strings.join(''),
}));

type Dotaz = { spojeni: number; sql: string };
const dotazy: Dotaz[] = [];
let spojeni = 0;
vi.mock('pg', () => ({
  Client: class {
    private id = ++spojeni;
    async connect() { /* nic */ }
    async end() { /* nic */ }
    async query(sql: string) {
      dotazy.push({ spojeni: this.id, sql });
      if (sql.includes('audience_provision_federated_member')) {
        return { rows: [{ audience_provision_federated_member: '11111111-1111-4111-8111-111111111111' }] };
      }
      return { rows: [] };
    }
  },
}));

import { registerAuthRoutes } from '../routes/auth.js';
import type { SourceBrokerConfig } from '../config.js';

const INCOMING = 'OM A HUM VAJRA GURU PADMA SIDDHI HUM';
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

const fakeSource = {
  connect: async () => {},
  getMemberByEmail: async () => ({
    userId: '11111111-1111-4111-8111-111111111111', email: 'clen@test.example', displayName: 'Člen', language: 'cs',
  }),
} as unknown as Parameters<typeof registerAuthRoutes>[2];

describe('/auth/source/login — zřízení člena', () => {
  it('nastaví nárok služby na tomtéž spojení PŘED audience_provision_federated_member', async () => {
    reqMock.mockImplementation((q: unknown) => {
      const s = String(q);
      if (s.includes('verifyOnboarding')) {
        return { verifyOnboarding: { onboarding: { existingUser: { id: '11111111-1111-4111-8111-111111111111', email: 'clen@test.example' } }, success: true, error: null } };
      }
      if (s.includes('sourceJwt')) {
        return { sourceJwt: { jwtSource: { token: 'jwt', authHandshake: INCOMING }, success: true, error: null } };
      }
      return {};
    });
    const app = Fastify({ logger: false });
    registerAuthRoutes(app, config(), fakeSource);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/auth/source/login', payload: { onboardingToken: 'ot', code: 'X' } });
    await app.close();

    const zrizeni = dotazy.findIndex((d) => d.sql.includes('audience_provision_federated_member'));
    expect(zrizeni, `odpověď ${res.statusCode}: ${res.body.slice(0, 200)}`).toBeGreaterThanOrEqual(0);
    const narok = dotazy.findIndex(
      (d) => d.spojeni === dotazy[zrizeni].spojeni && /SET request\.jwt\.claims = '\{"role":"service_role"\}'/.test(d.sql),
    );
    expect(narok).toBeGreaterThanOrEqual(0);
    expect(narok).toBeLessThan(zrizeni);
  });
});
