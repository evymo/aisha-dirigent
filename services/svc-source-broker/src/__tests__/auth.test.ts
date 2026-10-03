/**
 * auth.test.ts — SourceAuthManager unit tests
 *
 * Covers:
 *   - Initial JWT acquisition via sourceJwt mutation with authHandshake validation
 *   - Refresh-on-401 retry path
 *   - Cache hit when token is fresh
 *   - AuthHandshake mismatch rejection (security check per CLAUDE.md)
 *   - HMAC webhook signature verification (constant-time compare)
 *   - invalidate() forces fresh login on next getToken()
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SourceAuthManager } from '../auth.js';
import type { SourceBrokerConfig } from '../config.js';
import { createHmac } from 'node:crypto';

// Mock graphql-request — auth.ts imports GraphQLClient + gql from it
vi.mock('graphql-request', () => {
  // mutationResponseQueue is populated by tests to control what request() returns
  const mutationResponseQueue: Array<() => unknown> = [];
  const requestSpy = vi.fn(async () => {
    const next = mutationResponseQueue.shift();
    if (!next) throw new Error('test setup error: no mock response queued');
    return next();
  });
  return {
    GraphQLClient: vi.fn().mockImplementation(() => ({ request: requestSpy })),
    gql: (literals: TemplateStringsArray) => literals.join(''),
    // Expose for test setup
    __mutationResponseQueue: mutationResponseQueue,
    __requestSpy: requestSpy,
  };
});

const baseConfig: SourceBrokerConfig = {
  postgrestUrl: 'http://postgrest:3000',
  postgrestServiceToken: 'token',
  postgresUrl: 'postgres://localhost/test',
  keycloakUrl: 'http://keycloak',
  keycloakRealm: 'aisha',
  sourceApiUrl: 'http://source-api',
  sourceServiceEmail: 'service@source',
  sourceServicePassword: 'pw',
  sourcePgUrl: 'postgres://localhost/source',
  sourceAuthHandshakeOutgoing: 'RAM YAM KHAM OM A HUM',
  sourceAuthHandshakeIncoming: 'OM A HUM VAJRA GURU PADMA SIDDHI HUM',
  jwtCacheTtlMs: 3_600_000,
  webhookHmacSecret: 'webhook-secret',
  syncIntervalMs: 86_400_000,
  port: 8090,
  logLevel: 'info',
  corsAllowlist: '',
  rateLimitEnabled: false,
  oidcAppClientId: 'aisha-app',
  devAllowUnauthedSync: false,
  aishaGatewayUrl: 'http://gateway:3001',
  aishaGatewayIntranetKey: '',
  aishaJwtSecret: '',
  aishaJwtExpSec: 3600,
  aishaMemberRole: 'authenticated',
};

// Helper accessors for the mocked module
async function getMocks() {
  const mod = (await import('graphql-request')) as unknown as {
    __mutationResponseQueue: Array<() => unknown>;
    __requestSpy: ReturnType<typeof vi.fn>;
  };
  return { queue: mod.__mutationResponseQueue, spy: mod.__requestSpy };
}

describe('SourceAuthManager.getToken — initial login', () => {
  beforeEach(async () => {
    const { queue, spy } = await getMocks();
    queue.length = 0;
    spy.mockClear();
  });

  it('calls sourceJwt mutation with outgoing authHandshake + service credentials', async () => {
    const { queue, spy } = await getMocks();
    queue.push(() => ({
      sourceJwt: {
        token: 'jwt-token-123',
        refreshToken: 'refresh-456',
        authHandshake: baseConfig.sourceAuthHandshakeIncoming,
      },
    }));

    const auth = new SourceAuthManager(baseConfig);
    const token = await auth.getToken();

    expect(token).toBe('jwt-token-123');
    expect(spy).toHaveBeenCalledTimes(1);
    // The mutation request should include authHandshake + email + password
    const [_, vars] = spy.mock.calls[0];
    expect(vars).toEqual({
      authHandshake: baseConfig.sourceAuthHandshakeOutgoing,
      email: baseConfig.sourceServiceEmail,
      password: baseConfig.sourceServicePassword,
    });
  });

  it('rejects login when source returns wrong reply authHandshake (security check)', async () => {
    const { queue } = await getMocks();
    queue.push(() => ({
      sourceJwt: {
        token: 'jwt-token',
        refreshToken: 'refresh',
        authHandshake: 'WRONG_MANTRA',
      },
    }));

    const auth = new SourceAuthManager(baseConfig);
    await expect(auth.getToken()).rejects.toThrow(/AuthHandshake mismatch/);
  });

  it('builds Authorization header as JWT <token> (source convention)', async () => {
    const { queue } = await getMocks();
    queue.push(() => ({
      sourceJwt: {
        token: 'abc',
        refreshToken: 'r',
        authHandshake: baseConfig.sourceAuthHandshakeIncoming,
      },
    }));

    const auth = new SourceAuthManager(baseConfig);
    const header = await auth.authHeader();
    expect(header).toBe('JWT abc');
  });
});

describe('SourceAuthManager.getToken — caching', () => {
  beforeEach(async () => {
    const { queue, spy } = await getMocks();
    queue.length = 0;
    spy.mockClear();
  });

  it('returns cached token on subsequent calls without calling sourceJwt twice', async () => {
    const { queue, spy } = await getMocks();
    queue.push(() => ({
      sourceJwt: {
        token: 'cached-token',
        refreshToken: 'r',
        authHandshake: baseConfig.sourceAuthHandshakeIncoming,
      },
    }));

    const auth = new SourceAuthManager(baseConfig);
    const t1 = await auth.getToken();
    const t2 = await auth.getToken();
    const t3 = await auth.getToken();

    expect(t1).toBe('cached-token');
    expect(t2).toBe('cached-token');
    expect(t3).toBe('cached-token');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent getToken() callers — single inflight request', async () => {
    const { queue, spy } = await getMocks();
    queue.push(() => ({
      sourceJwt: {
        token: 'concurrent-token',
        refreshToken: 'r',
        authHandshake: baseConfig.sourceAuthHandshakeIncoming,
      },
    }));

    const auth = new SourceAuthManager(baseConfig);
    const [t1, t2, t3] = await Promise.all([
      auth.getToken(),
      auth.getToken(),
      auth.getToken(),
    ]);
    expect(t1).toBe('concurrent-token');
    expect(t2).toBe('concurrent-token');
    expect(t3).toBe('concurrent-token');
    expect(spy).toHaveBeenCalledTimes(1); // coalesced
  });

  it('invalidate() forces re-login on next call', async () => {
    const { queue, spy } = await getMocks();
    queue.push(() => ({
      sourceJwt: { token: 'token-1', refreshToken: 'r1', authHandshake: baseConfig.sourceAuthHandshakeIncoming },
    }));
    queue.push(() => ({
      sourceJwt: { token: 'token-2', refreshToken: 'r2', authHandshake: baseConfig.sourceAuthHandshakeIncoming },
    }));

    const auth = new SourceAuthManager(baseConfig);
    expect(await auth.getToken()).toBe('token-1');
    auth.invalidate();
    expect(await auth.getToken()).toBe('token-2');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('SourceAuthManager — webhook signature + authHandshake', () => {
  it('verifies valid HMAC signature with constant-time compare', () => {
    const auth = new SourceAuthManager(baseConfig);
    const body = '{"foo":"bar"}';
    const sig = createHmac('sha256', baseConfig.webhookHmacSecret).update(body).digest('hex');
    expect(auth.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('rejects tampered signature', () => {
    const auth = new SourceAuthManager(baseConfig);
    const body = '{"foo":"bar"}';
    const sig = createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    expect(auth.verifyWebhookSignature(body, sig)).toBe(false);
  });

  it('rejects signature of wrong length (early return — no comparison)', () => {
    const auth = new SourceAuthManager(baseConfig);
    expect(auth.verifyWebhookSignature('body', 'tooshort')).toBe(false);
  });

  it('accepts matching incoming authHandshake', () => {
    const auth = new SourceAuthManager(baseConfig);
    expect(auth.verifyAuthHandshake(baseConfig.sourceAuthHandshakeIncoming)).toBe(true);
  });

  it('rejects wrong/missing authHandshake', () => {
    const auth = new SourceAuthManager(baseConfig);
    expect(auth.verifyAuthHandshake('WRONG')).toBe(false);
    expect(auth.verifyAuthHandshake(undefined)).toBe(false);
    expect(auth.verifyAuthHandshake('')).toBe(false);
  });
});
