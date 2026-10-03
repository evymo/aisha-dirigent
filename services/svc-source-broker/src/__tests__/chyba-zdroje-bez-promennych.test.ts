/**
 * Chyba zdroje nesmí vynést proměnné požadavku — ani do logu, ani klientovi.
 *
 * graphql-request (7.x) skládá `ClientError.message` jako
 * `<zpráva>: JSON.stringify({ response, request })`, a `request.variables` jsou
 * vstupy mutace: e-mail (startOnboarding), OTP kód (verifyOnboarding) a sdílený
 * `authHandshake` brokeru se zdrojem (sourceJwt). routes/auth.ts tu zprávu logovalo
 * a vracelo v odpovědi — na routách BEZ stráže, takže vadný onboarding token
 * stačil, aby odpověď nesla tajemství handshaku.
 *
 * Měří se skutečnou `ClientError` z knihovny (ne ručně napodobenou), sestavenou
 * tak, jak ji staví knihovna sama (helpers/runRequest.js: `{ query, variables }`).
 * Kladná kotva ve STEJNÉM výstupu: řádek logu i zpráva zdroje tam jsou — jinak by
 * prošel i prázdný log.
 */
import { Writable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const reqMock = vi.fn();
vi.mock('graphql-request', async () => {
  const skutecna = await vi.importActual<typeof import('graphql-request')>('graphql-request');
  return {
    ClientError: skutecna.ClientError,
    GraphQLClient: class {
      request(...args: unknown[]) {
        return reqMock(...args);
      }
    },
    gql: (strings: TemplateStringsArray) => strings.join(''),
  };
});

const { ClientError } = await vi.importActual<typeof import('graphql-request')>('graphql-request');
import { registerAuthRoutes } from '../routes/auth.js';
import { errMessage } from '../errors.js';
import type { SourceBrokerConfig } from '../config.js';

const HANDSHAKE_VEN = 'SENTINEL-HANDSHAKE-VEN-7f3a';
const EMAIL = 'sentinel-email-7f3a@test.invalid';
const OTP = 'SENTINEL-OTP-7f3a';
const ZPRAVA_ZDROJE = 'Invalid onboarding';

function config(): SourceBrokerConfig {
  return {
    postgrestUrl: 'http://postgrest', postgrestServiceToken: 't', postgresUrl: 'postgres://t',
    keycloakUrl: 'http://k', keycloakRealm: 'aisha',
    // PR B1: klient webu instance místo keycloakBroker* (stráž běžného uživatele).
    oidcAppClientId: 'web-instance',
    sourceApiUrl: 'http://source', sourceServiceEmail: '', sourceServicePassword: '',
    sourcePgUrl: 'postgres://s',
    sourceAuthHandshakeOutgoing: HANDSHAKE_VEN, sourceAuthHandshakeIncoming: 'prichozi',
    jwtCacheTtlMs: 1, webhookHmacSecret: 's', syncIntervalMs: 1, port: 8090,
    logLevel: 'warn', corsAllowlist: '', rateLimitEnabled: false, devAllowUnauthedSync: false,
    aishaGatewayUrl: 'http://g', aishaGatewayIntranetKey: '', aishaJwtSecret: 'devsecret',
    aishaJwtExpSec: 3600, aishaMemberRole: 'authenticated',
  };
}

const fakeSource = {
  connect: async () => {},
  getMemberByEmail: async () => null,
} as unknown as Parameters<typeof registerAuthRoutes>[2];

/** ClientError přesně tak, jak ji staví graphql-request: response + { query, variables }. */
function chybaZdroje(query: unknown, variables: unknown, status = 200) {
  return new ClientError(
    { errors: [{ message: ZPRAVA_ZDROJE }], status, headers: {} } as never,
    { query: String(query), variables: variables as never },
  );
}

async function appSLogem() {
  const radky: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      radky.push(String(chunk));
      cb();
    },
  });
  const app = Fastify({ logger: { level: 'warn', stream } });
  registerAuthRoutes(app, config(), fakeSource);
  await app.ready();
  return { app, log: () => radky.join('') };
}

const jeVerify = (q: unknown) => typeof q === 'string' && q.includes('verifyOnboarding');
const jeJwt = (q: unknown) => typeof q === 'string' && q.includes('sourceJwt');

describe('chyba zdroje (graphql-request ClientError) nevynese proměnné požadavku', () => {
  // Blok, ne výraz: funkci vrácenou z beforeEach vitest po testu ZAVOLÁ jako úklid —
  // `() => reqMock.mockReset()` vrací mock, takže by se zavolal bez argumentů.
  beforeEach(() => {
    reqMock.mockReset();
  });

  it('měřidlo: surová ClientError proměnné OPRAVDU nese (jinak by test nic neměřil)', () => {
    const e = chybaZdroje('mutation sourceJwt', { authHandshake: HANDSHAKE_VEN });
    expect(e.message).toContain(HANDSHAKE_VEN);
  });

  it('errMessage vrátí zprávu zdroje, bez výpisu požadavku; bez zprávy jen HTTP kód', () => {
    expect(errMessage(chybaZdroje('q', { code: OTP }))).toBe(ZPRAVA_ZDROJE);
    const bezZpravy = new ClientError({ status: 502, headers: {} } as never, { query: 'q', variables: { code: OTP } as never });
    expect(errMessage(bezZpravy)).toBe('GraphQL Error (Code: 502)');
    expect(errMessage(new Error('obyčejná'))).toBe('obyčejná');
  });

  it('start: e-mail není v odpovědi ani v logu', async () => {
    reqMock.mockImplementation((q, v) => {
      throw chybaZdroje(q, v);
    });
    const { app, log } = await appSLogem();
    const res = await app.inject({ method: 'POST', url: '/auth/source/start', payload: { email: EMAIL } });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain(EMAIL);
    expect(log()).not.toContain(EMAIL);
    expect(res.json().message).toBe(ZPRAVA_ZDROJE);
    expect(log()).toContain('source start failed');
    await app.close();
  });

  it('verify: OTP kód není v odpovědi ani v logu', async () => {
    reqMock.mockImplementation((q, v) => {
      throw chybaZdroje(q, v);
    });
    const { app, log } = await appSLogem();
    const res = await app.inject({
      method: 'POST', url: '/auth/source/login', payload: { onboardingToken: 'ot', code: OTP },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain(OTP);
    expect(log()).not.toContain(OTP);
    expect(log()).toContain('source verify failed');
    await app.close();
  });

  it('sourceJwt: sdílený authHandshake není v odpovědi ani v logu', async () => {
    reqMock.mockImplementation((q, v) => {
      if (jeVerify(q)) {
        return { verifyOnboarding: { onboarding: { existingUser: { id: 'u', email: 'm@x' } }, success: true, error: null } };
      }
      if (jeJwt(q)) throw chybaZdroje(q, v);
      return {};
    });
    const { app, log } = await appSLogem();
    const res = await app.inject({
      method: 'POST', url: '/auth/source/login', payload: { onboardingToken: 'vadny', code: 'X' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('source_jwt_failed');
    expect(res.body).not.toContain(HANDSHAKE_VEN);
    expect(log()).not.toContain(HANDSHAKE_VEN);
    expect(log()).toContain('sourceJwt failed');
    await app.close();
  });
});
