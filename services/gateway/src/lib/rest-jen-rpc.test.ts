import Fastify, { type FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { restProxy } from '../routes/rest.js';
import { effectiveRestRole, isRestPathAllowed, REST_RPC_ONLY_ERROR } from './rest-jen-rpc.js';

const ISSUER = 'https://auth.example.test/realms/test';

async function bearer(claims: Record<string, unknown>): Promise<string> {
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode('test-only-secret-not-used-for-verification'));
  return `Bearer ${token}`;
}

describe('effectiveRestRole', () => {
  it('without a bearer the request is anon', () => {
    expect(effectiveRestRole(undefined, ISSUER)).toBe('anon');
    expect(effectiveRestRole('Basic abc', ISSUER)).toBe('anon');
  });

  it('reads the role claim of a pass-through PostgREST token', async () => {
    expect(effectiveRestRole(await bearer({ role: 'service_role' }), ISSUER)).toBe('service_role');
    expect(effectiveRestRole(await bearer({ role: 'authenticated', sub: 'u' }), ISSUER)).toBe('authenticated');
  });

  it('a Keycloak token is always a user, whatever role claim it carries', async () => {
    expect(effectiveRestRole(await bearer({ iss: ISSUER, role: 'service_role' }), ISSUER)).toBe('authenticated');
  });

  it('an unparseable bearer counts as anon', () => {
    expect(effectiveRestRole('Bearer not-a-jwt', ISSUER)).toBe('anon');
  });
});

describe('isRestPathAllowed', () => {
  it.each([
    '/rest/v1/rpc/get_my_stories',
    '/rest/v1/rpc/get_my_stories?limit=5',
    '/rest/v1/rpc/get_my_stories/',
    '/rest/v1/',
    '/rest/v1',
  ])('client may call %s', (url) => {
    expect(isRestPathAllowed(url, 'authenticated')).toBe(true);
    expect(isRestPathAllowed(url, 'anon')).toBe(true);
  });

  it.each([
    '/rest/v1/profiles',
    '/rest/v1/profiles?select=*',
    '/rest/v1/app_secrets?select=value',
    '/rest/v1/rpc',
    '/rest/v1/rpc/',
    '/rest/v1/rpc/../profiles',
    '/rest/v1/rpc/x/../../profiles',
    '/rest/v1/%72pc/get_my_stories',
    '/rest/v1/rpc%2F..%2Fprofiles',
    '/rest/v1//profiles',
    '/rest/v1/rpc/fn-with-dash',
  ])('client may NOT call %s', (url) => {
    expect(isRestPathAllowed(url, 'authenticated')).toBe(false);
    expect(isRestPathAllowed(url, 'anon')).toBe(false);
  });

  it('service_role keeps table access (n8n, e2e fixtures, internal services)', () => {
    expect(isRestPathAllowed('/rest/v1/audit_journal?select=id', 'service_role')).toBe(true);
  });
});

describe('restProxy — RPC-only hook in front of PostgREST', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  async function inject(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, authorization?: string) {
    app = Fastify();
    await app.register(restProxy, { prefix: '/rest/v1' });
    return app.inject({ method, url, headers: authorization ? { authorization } : {} });
  }

  it('403 rest_rpc_only for a signed-in user reading a table', async () => {
    const res = await inject('GET', '/rest/v1/profiles?select=*', await bearer({ iss: config.kcIssuer, sub: 'u' }));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: REST_RPC_ONLY_ERROR });
  });

  it('403 for anonymous table writes', async () => {
    const res = await inject('DELETE', '/rest/v1/partner_profiles_public?id=eq.1');
    expect(res.statusCode).toBe(403);
  });

  it('an RPC call is not stopped by the hook', async () => {
    // Upstream is a `.invalid` host, so the proxy itself fails — what matters is
    // that the request got past the RPC-only hook (not 403 rest_rpc_only).
    const res = await inject('POST', '/rest/v1/rpc/get_my_stories', await bearer({ role: 'authenticated', sub: 'u' }));
    expect(res.statusCode).not.toBe(403);
  });

  it('service_role still reaches tables', async () => {
    const res = await inject('GET', '/rest/v1/audit_journal?select=id', await bearer({ role: 'service_role' }));
    expect(res.statusCode).not.toBe(403);
  });
});
