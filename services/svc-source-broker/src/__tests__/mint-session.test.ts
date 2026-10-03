/**
 * mint-session.test.ts — mintAishaSession() unit tests
 *
 * Covers the two issuance paths and the least-privilege guarantees:
 *   PRIMARY  gateway /token-exchange (broker holds NO signing secret)
 *   FALLBACK local HS256 mint (dev/local only)
 *
 * The live federation test (make aisha-test-federation) exercises the FALLBACK
 * path end-to-end; these tests exercise the GATEWAY path (which can't be enabled
 * in the local Coolify-managed gateway) with a mocked fetch, plus the control
 * flow between the two.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decodeJwt } from 'jose';
import { mintAishaSession } from '../routes/auth.js';
import type { SourceBrokerConfig } from '../config.js';

const log = { info: vi.fn(), warn: vi.fn() };

/** Build a config exposing only the fields mintAishaSession reads. */
function cfg(over: Partial<SourceBrokerConfig>): SourceBrokerConfig {
  return {
    aishaGatewayUrl: 'http://gateway:3001',
    aishaGatewayIntranetKey: '',
    aishaJwtSecret: '',
    aishaJwtExpSec: 3600,
    aishaMemberRole: 'authenticated',
    ...over,
  } as unknown as SourceBrokerConfig;
}

const EMAIL = 'member@source';
const SUB = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  log.info.mockClear();
  log.warn.mockClear();
  vi.unstubAllGlobals();
});

describe('mintAishaSession — PRIMARY gateway /token-exchange', () => {
  it('uses the gateway token when it mints (broker holds no secret)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ jwt: 'gateway.signed.jwt', user_id: SUB }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    // NOTE: no aishaJwtSecret — the gateway path must work WITHOUT it.
    const out = await mintAishaSession(cfg({ aishaGatewayIntranetKey: 'k' }), EMAIL, SUB, log);

    expect(out).toEqual({ token: 'gateway.signed.jwt', via: 'gateway', sub: SUB });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string> },
    ];
    expect(url).toBe('http://gateway:3001/token-exchange');
    expect(init.method).toBe('POST');
    expect(init.headers['x-intranet-api-key']).toBe('k');
    expect(init.headers['x-auth-request-email']).toBe(EMAIL);
  });

  it('skips the gateway entirely when no intranet key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await mintAishaSession(cfg({ aishaJwtSecret: 'fallback-secret' }), EMAIL, SUB, log);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out!.via).toBe('broker-mint');
  });
});

describe('mintAishaSession — FALLBACK to local mint', () => {
  it('falls back when the gateway returns non-200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }))
    );

    const out = await mintAishaSession(
      cfg({ aishaGatewayIntranetKey: 'k', aishaJwtSecret: 'fallback-secret' }),
      EMAIL,
      SUB,
      log
    );

    expect(out!.via).toBe('broker-mint');
    expect(log.warn).toHaveBeenCalled();
  });

  it('falls back when the gateway is unreachable (fetch throws)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );

    const out = await mintAishaSession(
      cfg({ aishaGatewayIntranetKey: 'k', aishaJwtSecret: 'fallback-secret' }),
      EMAIL,
      SUB,
      log
    );

    expect(out!.via).toBe('broker-mint');
  });

  it('the locally-minted token is role=authenticated, scoped, source_member=true', async () => {
    const out = await mintAishaSession(cfg({ aishaJwtSecret: 'fallback-secret' }), EMAIL, SUB, log);
    expect(out!.via).toBe('broker-mint');

    const claims = decodeJwt(out!.token);
    expect(claims.role).toBe('authenticated'); // NEVER admin/service_role
    expect(claims.sub).toBe(SUB);
    expect(claims.email).toBe(EMAIL);
    expect(claims.source_member).toBe(true);
    expect(claims.federated_from).toBe('source-api');
  });
});

describe('mintAishaSession — no path configured', () => {
  it('returns null when neither gateway key nor fallback secret is set', async () => {
    const out = await mintAishaSession(cfg({}), EMAIL, SUB, log);
    expect(out).toBeNull();
  });
});
