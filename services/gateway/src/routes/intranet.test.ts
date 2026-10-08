import Fastify, { type FastifyInstance } from 'fastify';
import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── S2 behavioral-test mocks ─────────────────────────────────────────────────
// The approved S2 fix imports verifyKeycloakClaims from ../auth/postgrest-jwt.js
// and isTokenRevoked from ../auth/jwt-revocation.js. We mock BOTH at the module
// boundary so we can drive verified/revoked identity deterministically. These
// mocks are inert against the current (buggy) intranet.ts — which imports
// neither module — so the pre-fix behaviour is unchanged and the new cases go
// RED for the right reason (identity taken from the header, not a verified
// token). Once the fix wires the imports, the mocks take over.
const s2 = vi.hoisted(() => ({
  verifyKeycloakClaims: vi.fn(),
  isTokenRevoked: vi.fn(),
}));

vi.mock('../auth/postgrest-jwt.js', () => ({
  verifyKeycloakClaims: s2.verifyKeycloakClaims,
  createPostgrestJwtTranslator: vi.fn(),
  translateAuthorizationForPostgrest: vi.fn(),
}));

vi.mock('../auth/jwt-revocation.js', () => ({
  isTokenRevoked: s2.isTokenRevoked,
  // Alias, in case the fix references the translator-style `isRevoked` name.
  isRevoked: s2.isTokenRevoked,
  revokeToken: vi.fn(),
}));

const originalIntranetApiKey = process.env.INTRANET_API_KEY;

async function buildApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.INTRANET_API_KEY = 'intranet-test-key';
  const { intranetRoutes } = await import('./intranet.js');

  const app = Fastify();
  await app.register(intranetRoutes, { prefix: '/intranet' });
  return app;
}

afterEach(() => {
  if (originalIntranetApiKey === undefined) {
    delete process.env.INTRANET_API_KEY;
  } else {
    process.env.INTRANET_API_KEY = originalIntranetApiKey;
  }

  vi.unstubAllGlobals();
});

describe('intranet RPC proxy allowlist', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('rejects non-allowlisted RPC names before user lookup or upstream forwarding', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/intranet/rpc/admin_reset_user_password',
        headers: { 'x-intranet-api-key': 'intranet-test-key' },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'rpc_not_allowed' });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('lets allowlisted RPC names reach the verified-token gate (S2: no Bearer → 401)', async () => {
    // S2: identity now comes from a verified Keycloak token, not a trusted
    // header. A valid shared key with an allowlisted fn but NO bearer token is
    // rejected fail-loud (invalid_token) before any user lookup or forwarding —
    // it no longer falls through to the old 400 missing_user_email header gate.
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/intranet/rpc/get_intranet_channels',
        headers: { 'x-intranet-api-key': 'intranet-test-key' },
        payload: {},
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_token' });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

// ── S2: token-exchange / rpc / mcp identity isolation (behavioral) ────────────
// These are KNOWN-RED at authoring: the current intranet.ts trusts the
// X-Auth-Request-Email / X-Appsmith-User-Email header as identity, gated only by
// the shared X-Intranet-Api-Key. Do NOT weaken them to pass — they encode the S2
// contract (identity comes ONLY from a verified, non-revoked Keycloak token; sub
// derives from the DB user, not the header and not the raw KC subject).

const API_KEY = 'intranet-test-key';

const ALICE_EMAIL = 'alice@corp.test';
const VICTIM_EMAIL = 'victim@corp.test';
const ALICE_DB_ID = 'db-alice-0001';
const VICTIM_DB_ID = 'db-victim-9999';
const KC_ALICE_SUB = 'kc-subject-alice'; // raw KC subject — must NOT become the minted sub
const INTRANET_CLIENT = 'aisha-appsmith-intranet-proxy';

const POSTGREST_URL = 'http://postgrest:3000';
const MCP_UPSTREAM = 'http://svc-mcp-knowledge:3010';

const aliceClaims = {
  sub: KC_ALICE_SUB,
  email: ALICE_EMAIL,
  preferred_username: ALICE_EMAIL,
  azp: INTRANET_CLIENT,
  aud: INTRANET_CLIENT,
  jti: 'jti-alice-1',
  iss: 'http://keycloak:8080/realms/aisha',
};

const originalEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  if (!(key in originalEnv)) originalEnv[key] = process.env[key];
  process.env[key] = value;
}

const usersByEmail: Record<string, { id: string; roles: string[] }> = {
  [ALICE_EMAIL]: { id: ALICE_DB_ID, roles: ['authenticated'] },
  [VICTIM_EMAIL]: { id: VICTIM_DB_ID, roles: ['authenticated'] },
};

/**
 * fetch mock covering every upstream intranet.ts talks to:
 *   - lookupUserByEmail → POSTGREST /rpc/get_user_by_email (returns the DB user)
 *   - /rpc proxy        → POSTGREST /rpc/<fn>            (echoes ok)
 *   - /mcp proxy        → MCP_UPSTREAM /mcp              (echoes ok)
 */
function installFetchMock(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: unknown, init?: { body?: string; headers?: Record<string, string> }) => {
    const url = String(input);
    if (url.includes('/rpc/get_user_by_email')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { p_email?: string };
      const rec = body.p_email ? usersByEmail[body.p_email] : undefined;
      if (!rec) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify({ id: rec.id, email: body.p_email, roles: rec.roles }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // proxy passthroughs (rpc fn / mcp)
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function findCall(mock: ReturnType<typeof vi.fn>, urlSubstr: string): [string, { headers?: Record<string, string>; body?: string }] | undefined {
  const call = mock.mock.calls.find((c) => String(c[0]).includes(urlSubstr));
  return call as [string, { headers?: Record<string, string>; body?: string }] | undefined;
}

function bearerSubOf(headers: Record<string, string> | undefined): string | undefined {
  const auth = headers?.Authorization ?? headers?.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return undefined;
  return decodeJwt(auth.slice('Bearer '.length)).sub;
}

beforeEach(() => {
  s2.verifyKeycloakClaims.mockReset();
  s2.isTokenRevoked.mockReset();
  // Defaults: no valid token, nothing revoked. Individual cases override.
  s2.verifyKeycloakClaims.mockResolvedValue(null);
  s2.isTokenRevoked.mockResolvedValue(false);

  // A non-empty PostgREST secret so mintUserJwt() can sign (we only decode it).
  setEnv('JWT_SECRET', 'test-postgrest-secret-please');
  // The dedicated intranet-client allowlist (R2) — set under both plausible
  // env names so whichever the fix wires is present, and the verified azp is
  // accepted on the happy path.
  setEnv('KC_INTRANET_ALLOWED_CLIENTS', INTRANET_CLIENT);
  setEnv('INTRANET_OIDC_CLIENT', INTRANET_CLIENT);
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(originalEnv)) delete originalEnv[key];
});

describe('S2 /token-exchange identity isolation', () => {
  it('(a) spoofed header + valid key but NO Bearer → 401, no user JWT minted', async () => {
    const fetchMock = installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/token-exchange',
        headers: {
          'x-intranet-api-key': API_KEY,
          'x-appsmith-user-email': VICTIM_EMAIL, // spoofed identity, no verified token
        },
        payload: {},
      });

      expect(res.statusCode).toBe(401);
      // A minted user JWT would appear as `jwt` in the body — it must not.
      expect(res.json()).not.toHaveProperty('jwt');
      // No user JWT was forged for the spoofed victim.
      expect(findCall(fetchMock, '/rpc/get_user_by_email')).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('(b) verified token=alice but conflicting header=victim → minted identity derives from alice', async () => {
    s2.verifyKeycloakClaims.mockResolvedValue(aliceClaims);
    installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/token-exchange',
        headers: {
          'x-intranet-api-key': API_KEY,
          'x-appsmith-user-email': VICTIM_EMAIL, // attacker-controlled, must be ignored
          authorization: 'Bearer verified-alice-token',
        },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const { jwt } = res.json() as { jwt: string };
      const claims = decodeJwt(jwt);
      expect(claims.email).toBe(ALICE_EMAIL);
      expect(claims.sub).toBe(ALICE_DB_ID); // DB user id for alice
      expect(claims.sub).not.toBe(VICTIM_DB_ID); // NOT the spoofed header identity
      expect(claims.sub).not.toBe(KC_ALICE_SUB); // NOT the raw KC subject (R4)
    } finally {
      await app.close();
    }
  });

  it('(c) absent shared key → 401', async () => {
    s2.verifyKeycloakClaims.mockResolvedValue(aliceClaims);
    installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/token-exchange',
        headers: { authorization: 'Bearer verified-alice-token' }, // no x-intranet-api-key
        payload: {},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).not.toHaveProperty('jwt');
    } finally {
      await app.close();
    }
  });

  it('(d) revoked token → 401, no user JWT minted', async () => {
    s2.verifyKeycloakClaims.mockResolvedValue(aliceClaims);
    s2.isTokenRevoked.mockResolvedValue(true);
    installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/token-exchange',
        headers: {
          'x-intranet-api-key': API_KEY,
          'x-appsmith-user-email': ALICE_EMAIL,
          authorization: 'Bearer revoked-alice-token',
        },
        payload: {},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).not.toHaveProperty('jwt');
    } finally {
      await app.close();
    }
  });

  it('(e) valid token but from a NON-intranet client (e.g. the SPA) → 401 client_not_allowed (R2)', async () => {
    // A token minted for aisha-app passes the broad verifyKeycloakClaims allow-list
    // but must be rejected here — otherwise any SPA login is a self-serve minting oracle.
    s2.verifyKeycloakClaims.mockResolvedValue({ ...aliceClaims, azp: 'aisha-app', aud: 'aisha-app' });
    const fetchMock = installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/token-exchange',
        headers: { 'x-intranet-api-key': API_KEY, authorization: 'Bearer verified-spa-token' },
        payload: {},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'client_not_allowed' });
      expect(res.json()).not.toHaveProperty('jwt');
      expect(findCall(fetchMock, '/rpc/get_user_by_email')).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('(f) verified token carrying no jti → 401 (cannot be revocation-checked, R3 fail-loud)', async () => {
    s2.verifyKeycloakClaims.mockResolvedValue({ ...aliceClaims, jti: undefined });
    const fetchMock = installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/token-exchange',
        headers: { 'x-intranet-api-key': API_KEY, authorization: 'Bearer no-jti-token' },
        payload: {},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).not.toHaveProperty('jwt');
      expect(findCall(fetchMock, '/rpc/get_user_by_email')).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('S2 /rpc identity isolation', () => {
  it('(a) spoofed header + valid key but NO Bearer → 401, nothing forwarded to PostgREST', async () => {
    const fetchMock = installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/rpc/get_intranet_channels',
        headers: {
          'x-intranet-api-key': API_KEY,
          'x-appsmith-user-email': VICTIM_EMAIL,
        },
        payload: {},
      });

      expect(res.statusCode).toBe(401);
      // No user JWT forged, nothing proxied under a spoofed identity.
      expect(findCall(fetchMock, '/rpc/get_intranet_channels')).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('(b) verified token=alice + conflicting header=victim → proxied JWT identity derives from alice', async () => {
    s2.verifyKeycloakClaims.mockResolvedValue(aliceClaims);
    const fetchMock = installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/rpc/get_intranet_channels',
        headers: {
          'x-intranet-api-key': API_KEY,
          'x-appsmith-user-email': VICTIM_EMAIL,
          authorization: 'Bearer verified-alice-token',
        },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const proxied = findCall(fetchMock, '/rpc/get_intranet_channels');
      expect(proxied, 'expected an upstream PostgREST proxy call').toBeDefined();
      const sub = bearerSubOf(proxied?.[1].headers);
      expect(sub).toBe(ALICE_DB_ID);
      expect(sub).not.toBe(VICTIM_DB_ID);
      expect(sub).not.toBe(KC_ALICE_SUB);
    } finally {
      await app.close();
    }
  });
});

describe('S2 /mcp identity isolation', () => {
  it('(a) spoofed header + valid key but NO Bearer → 401, nothing forwarded to MCP', async () => {
    const fetchMock = installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/mcp',
        headers: {
          'x-intranet-api-key': API_KEY,
          'x-appsmith-user-email': VICTIM_EMAIL,
        },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      });

      expect(res.statusCode).toBe(401);
      expect(findCall(fetchMock, `${MCP_UPSTREAM}/mcp`)).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('(b) verified token=alice + conflicting header=victim → identity forwarded to MCP derives from alice', async () => {
    s2.verifyKeycloakClaims.mockResolvedValue(aliceClaims);
    const fetchMock = installFetchMock();
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/mcp',
        headers: {
          'x-intranet-api-key': API_KEY,
          'x-appsmith-user-email': VICTIM_EMAIL,
          authorization: 'Bearer verified-alice-token',
        },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      });

      expect(res.statusCode).toBe(200);
      const forwarded = findCall(fetchMock, `${MCP_UPSTREAM}/mcp`);
      expect(forwarded, 'expected an upstream MCP proxy call').toBeDefined();
      const headerBlob = JSON.stringify(forwarded?.[1].headers ?? {});
      expect(headerBlob).toContain(ALICE_EMAIL); // verified identity forwarded
      expect(headerBlob).not.toContain(VICTIM_EMAIL); // spoofed header must not leak as identity
    } finally {
      await app.close();
    }
  });
});

// ── Kdo: log intranetu nese userId, ne e-mail ─────────────────────────────────
// Logger brány (safeLoggerOptions) e-mail jako PII redaktuje; kdyby řádek nesl
// jen `email`, u zablokovaného nástroje MCP by chybělo, kdo to byl.
describe('intranet log names the user by userId', () => {
  it('blocked MCP tool: the log line carries userId, the e-mail does not reach the log', async () => {
    const { Writable } = await import('node:stream');
    const { safeLoggerOptions } = await import('@aisha/security');
    const kusy: string[] = [];
    const proud = new Writable({ write(k: Buffer, _e, hotovo) { kusy.push(k.toString('utf8')); hotovo(); } });

    s2.verifyKeycloakClaims.mockResolvedValue(aliceClaims);
    installFetchMock();
    vi.resetModules();
    process.env.INTRANET_API_KEY = API_KEY;
    const { intranetRoutes } = await import('./intranet.js');
    const app = Fastify({ logger: safeLoggerOptions({ level: 'info', stream: proud }) });
    await app.register(intranetRoutes, { prefix: '/intranet' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/intranet/mcp',
        headers: { 'x-intranet-api-key': API_KEY, authorization: 'Bearer verified-alice-token' },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'admin_deploy' } },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
    const radky = kusy.join('').trim().split('\n').map((r) => JSON.parse(r) as Record<string, unknown>);
    const blokovano = radky.find((r) => r.msg === 'intranet MCP tool blocked');
    expect(blokovano).toMatchObject({ tool: 'admin_deploy', userId: ALICE_DB_ID });
    expect(kusy.join('')).not.toContain(ALICE_EMAIL);
  });
});
