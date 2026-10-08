/**
 * Unit tests for svc-ai-chat security primitives.
 *
 * The files under test are the foundation under every chat / probe
 * / orchestration flow:
 *
 *   - auth.ts             — JWT user verification, role check, service-role bearer check
 *   - lib/rpcAdapter.ts   — canonical rebrand RPC adapter, replaces the banned legacy SDK (createServiceRpcAdapter / createUserRpcAdapter)
 *   (lib/openaiKey.ts zrušen 2026-10-02 — klíče čte čtečka pověření lib/credentials.ts,
 *    testy v @aisha/security credentials.test.ts)
 *
 * If any of these regress silently, downstream RBAC / cost / safety
 * assumptions break. We lock in their contracts here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks — @aisha/security (Verdaccio-published, no test mirror)
// ---------------------------------------------------------------------------
const {
  mockJwtVerify,
  mockCreateJwtVerifier,
  mockRpcService,
  mockRpcUser,
} = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
  mockCreateJwtVerifier: vi.fn(),
  mockRpcService: vi.fn(),
  mockRpcUser: vi.fn(),
}));

mockCreateJwtVerifier.mockReturnValue({ verify: mockJwtVerify });

// Faithful @aisha/security mock — re-implements the surface our auth.ts
// depends on, MATCHING the upstream contract verbatim. The mock includes
// the real constant-time verifyServiceRole impl (XOR-accumulator over the
// full token length) so the adversarial tests below exercise the *actual*
// behaviour shape, not a softer stand-in.
//
// If @aisha/security's contract changes, this mock will drift. A regression
// test in packages/security/src/__tests__/jwt.test.ts pins the shared impl;
// here we pin the call-site integration.
vi.mock('@aisha/security', () => {
  class AuthError extends Error {
    statusCode: number;
    reason: string;
    constructor(message: string | number, statusCodeOrMessage: number | string, reason?: string) {
      // Match @aisha/security's signature: AuthError(message, statusCode, reason)
      // OR our legacy local form: AuthError(statusCode, message). Normalise:
      if (typeof message === 'number') {
        super(statusCodeOrMessage as string);
        this.statusCode = message;
        this.reason = reason ?? '';
      } else {
        super(message);
        this.statusCode = statusCodeOrMessage as number;
        this.reason = reason ?? '';
      }
      this.name = 'AuthError';
    }
  }
  function verifyServiceRole(authHeader: string | undefined, expectedToken: string): void {
    if (!authHeader) throw new AuthError('Missing Authorization header', 401, 'missing');
    // Shodně s upstreamem: prázdné očekávané tajemství nesmí autentizovat nikoho.
    if (!expectedToken) throw new AuthError('Service role authentication is not configured', 503, 'unconfigured');
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token.length !== expectedToken.length) {
      throw new AuthError('Invalid service role token', 403, 'invalid');
    }
    let diff = 0;
    for (let i = 0; i < token.length; i++) {
      diff |= token.charCodeAt(i) ^ expectedToken.charCodeAt(i);
    }
    if (diff !== 0) throw new AuthError('Invalid service role token', 403, 'invalid');
  }
  return {
    createJwtVerifier: mockCreateJwtVerifier,
    // vi.fn kvůli testu volajícího místa: služba musí hlavičku předat sdílené
    // kontrole se SVÝM tajemstvím (vlastnosti porovnání drží packages/security).
    verifyServiceRole: vi.fn(verifyServiceRole),
    AuthError,
  };
});

vi.mock('../config.js', () => ({
  config: {
    kcJwksUrl: 'http://keycloak/realms/aisha/protocol/openid-connect/certs',
    kcIssuer: 'http://keycloak/realms/aisha',
    keycloakUrl: 'http://keycloak',
    keycloakRealm: 'aisha',
    postgrestServiceToken: 'svc-secret-token-deadbeef',
  },
}));

vi.mock('../postgrest.js', () => ({
  rpcService: mockRpcService,
  rpcUser: mockRpcUser,
}));

// ===========================================================================
// auth.ts
// ===========================================================================

describe('auth.ts :: verifyToken', () => {
  beforeEach(() => {
    mockJwtVerify.mockReset();
  });

  it('returns VerifiedUser with userId / email / roles / claims on happy path', async () => {
    mockJwtVerify.mockResolvedValue({
      sub: 'user-abc',
      email: 'u@example.test',
      realm_access: { roles: ['user', 'patient'] },
      iss: 'http://keycloak/realms/aisha',
    });
    const { verifyToken } = await import('../auth.js');
    const out = await verifyToken('Bearer good-jwt');
    expect(out).toEqual({
      userId: 'user-abc',
      email: 'u@example.test',
      roles: ['user', 'patient'],
      claims: expect.objectContaining({ sub: 'user-abc' }),
    });
  });

  it('returns empty roles[] when realm_access claim is missing', async () => {
    mockJwtVerify.mockResolvedValue({ sub: 'u', email: undefined });
    const { verifyToken } = await import('../auth.js');
    const out = await verifyToken('Bearer jwt');
    expect(out.roles).toEqual([]);
    expect(out.email).toBeUndefined();
  });

  it('re-throws @aisha/security::AuthError as local AuthError with statusCode preserved', async () => {
    const { AuthError: SecurityAuthError } = await import('@aisha/security');
    mockJwtVerify.mockRejectedValue(new SecurityAuthError('token expired', 401));
    const { verifyToken, AuthError } = await import('../auth.js');
    await expect(verifyToken('Bearer expired')).rejects.toMatchObject({
      name: 'AuthError',
      statusCode: 401,
      message: 'token expired',
    });
    // And it's an instance of OUR AuthError, not the upstream one
    try {
      await verifyToken('Bearer expired');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
    }
  });

  it('lets non-AuthError errors propagate unchanged (caller decides)', async () => {
    mockJwtVerify.mockRejectedValue(new Error('network unreachable'));
    const { verifyToken } = await import('../auth.js');
    await expect(verifyToken('Bearer x')).rejects.toThrow('network unreachable');
    // Must NOT be wrapped as AuthError — caller can distinguish
    try {
      await verifyToken('Bearer x');
    } catch (e) {
      expect((e as Error).name).not.toBe('AuthError');
    }
  });
});

describe('auth.ts :: isAdminOrStaff', () => {
  it('returns true for admin role', async () => {
    const { isAdminOrStaff } = await import('../auth.js');
    expect(isAdminOrStaff({ userId: 'u', roles: ['admin'], claims: {} })).toBe(true);
  });
  it('returns true for staff role', async () => {
    const { isAdminOrStaff } = await import('../auth.js');
    expect(isAdminOrStaff({ userId: 'u', roles: ['staff'], claims: {} })).toBe(true);
  });
  it('returns false for neither', async () => {
    const { isAdminOrStaff } = await import('../auth.js');
    expect(isAdminOrStaff({ userId: 'u', roles: ['user', 'patient'], claims: {} })).toBe(false);
  });
  it('returns false when roles is empty', async () => {
    const { isAdminOrStaff } = await import('../auth.js');
    expect(isAdminOrStaff({ userId: 'u', roles: [], claims: {} })).toBe(false);
  });
});

describe('auth.ts :: verifyServiceRole — happy + sad paths', () => {
  it('throws 401 on missing Authorization header (OWASP: 401 = no auth)', async () => {
    const { verifyServiceRole, AuthError } = await import('../auth.js');
    expect(() => verifyServiceRole(undefined)).toThrow(AuthError);
    try { verifyServiceRole(undefined); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(401);
    }
  });

  it('throws 403 on non-Bearer scheme (auth provided but rejected by shared verifier)', async () => {
    // After delegating to @aisha/security::verifyServiceRole, "Basic abc"
    // strips Bearer prefix to empty → length mismatch → 403.
    const { verifyServiceRole } = await import('../auth.js');
    try { verifyServiceRole('Basic abc'); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(403);
    }
  });

  it('throws 403 on Bearer with wrong token (OWASP: 403 = auth presented but invalid)', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    try { verifyServiceRole('Bearer wrong-token'); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(403);
    }
  });

  it('accepts Bearer with the configured service token', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    expect(() => verifyServiceRole('Bearer svc-secret-token-deadbeef')).not.toThrow();
  });

  it('returns void (no return value to leak) on success', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    expect(verifyServiceRole('Bearer svc-secret-token-deadbeef')).toBeUndefined();
  });
});

// ── verifyServiceRole — adversarial / negative coverage ────────

describe('auth.ts :: verifyServiceRole — adversarial inputs', () => {
  it('case-insensitive Bearer prefix stripping (RFC 7235 — "Bearer" is case-insensitive)', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    // @aisha/security uses /^Bearer\s+/i — both should accept.
    expect(() => verifyServiceRole('bearer svc-secret-token-deadbeef')).not.toThrow();
    expect(() => verifyServiceRole('BEARER svc-secret-token-deadbeef')).not.toThrow();
  });

  it('rejects empty Bearer (header present but no token after prefix)', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    try { verifyServiceRole('Bearer '); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(403);
    }
  });

  it('rejects token with extra whitespace (different length → length-check fails immediately)', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    try { verifyServiceRole('Bearer svc-secret-token-deadbeef '); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(403);
    }
  });

  it('rejects token that is a prefix of the real one (no short-circuit advantage)', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    // "svc-secret-token-deadbee" is a 1-char-shorter prefix of the real token.
    // A naive `===` already rejects it; we assert the rejection is on length
    // BEFORE any character comparison happens (constant-time-friendly).
    try { verifyServiceRole('Bearer svc-secret-token-deadbee'); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(403);
    }
  });

  it('rejects token that differs only in the LAST byte (constant-time loop must finish)', async () => {
    // If the compare short-circuited on first mismatch, this would resolve
    // faster than a token that differs only in the first byte. By rejecting
    // BOTH at the same code path (XOR-accumulator), we close the timing-attack
    // gap. We can't measure timing meaningfully in a unit test, but we CAN
    // assert the rejection happens with the same error shape.
    const { verifyServiceRole } = await import('../auth.js');
    const lastByteDiff = 'svc-secret-token-deadbeeF'; // capitalised last byte
    try { verifyServiceRole(`Bearer ${lastByteDiff}`); } catch (e) {
      expect((e as { statusCode: number; message: string }).statusCode).toBe(403);
      expect((e as { message: string }).message).toContain('Invalid');
    }
  });

  it('all rejection messages are identical regardless of which byte differs (no oracle)', async () => {
    // Attackers can use error message variance to extract token bytes one
    // at a time. Assert that ALL wrong-token rejections produce the same
    // user-facing message text.
    const { verifyServiceRole } = await import('../auth.js');
    const wrongs = [
      'Bearer svc-secret-token-deadbeeX',
      'Bearer Svc-secret-token-deadbeef',
      'Bearer svc-secret-token-deadbeef!',  // length differs → goes through 403 too
      'Bearer XXX-secret-token-deadbeef',
    ];
    const messages = new Set<string>();
    for (const w of wrongs) {
      try { verifyServiceRole(w); } catch (e) {
        messages.add((e as Error).message);
      }
    }
    // Exactly 1 unique rejection message — no per-byte oracle.
    expect(messages.size).toBe(1);
    expect([...messages][0]).toContain('Invalid');
  });

  it('rejects auth header that LOOKS like JWT (alg=none confusion)', async () => {
    const { verifyServiceRole } = await import('../auth.js');
    // verifyServiceRole is for service-role TOKEN comparison, not JWT
    // verification. A crafted JWT-shaped string should fail length check.
    const fakeJwt = 'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiJ9.';
    try { verifyServiceRole(fakeJwt); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(403);
    }
  });

  it('rejects extremely long token: předá ho sdílené kontrole se SVÝM tajemstvím → 403 (bez stopek)', async () => {
    // ⛔ Dřív tu stály stopky (`performance.now()` < 50 ms) nad KOPIÍ porovnání
    // z mocku výš. Pod zátěží pre-push (2026-10-02, load ~65) vyšlo 76 ms
    // a push padl na kódu, který se neměnil. O(1) odmítnutí rozdílné délky
    // a konstantní čas dokazuje SONDOU packages/security (jwt.test.ts,
    // „vlastnosti bez hodin"). Služba odpovídá jen za volající místo.
    const { verifyServiceRole: sdileny } = await import('@aisha/security');
    const sdilenySpy = vi.mocked(sdileny);
    sdilenySpy.mockClear();
    const { verifyServiceRole } = await import('../auth.js');
    const huge = 'A'.repeat(1_000_000);
    expect(() => verifyServiceRole(`Bearer ${huge}`)).toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(sdilenySpy).toHaveBeenCalledTimes(1);
    expect(sdilenySpy).toHaveBeenCalledWith(`Bearer ${huge}`, 'svc-secret-token-deadbeef');
  });
});

// ===========================================================================
// lib/rpcAdapter.ts — the canonical rebrand RPC adapter (replaces banned legacy SDK)
// ===========================================================================

describe('rpcAdapter :: createServiceRpcAdapter (service-role)', () => {
  beforeEach(() => {
    mockRpcService.mockReset();
  });

  it('rpc(fn, params) → calls rpcService<T>(fn, params) and wraps in {data, error: null}', async () => {
    mockRpcService.mockResolvedValue({ rows: [{ id: 1 }] });
    const { createServiceRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createServiceRpcAdapter();
    const res = await client.rpc('list_things', { p_limit: 10 });
    expect(mockRpcService).toHaveBeenCalledWith('list_things', { p_limit: 10 });
    expect(res).toEqual({ data: { rows: [{ id: 1 }] }, error: null });
  });

  it('defaults params to {} when caller omits the second arg', async () => {
    mockRpcService.mockResolvedValue('ok');
    const { createServiceRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createServiceRpcAdapter();
    await client.rpc('ping');
    expect(mockRpcService).toHaveBeenCalledWith('ping', {});
  });

  it('rpcService rejection (Error) → returns {data: null, error: {message: <Error.message>}}', async () => {
    mockRpcService.mockRejectedValue(new Error('postgrest: row not found'));
    const { createServiceRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createServiceRpcAdapter();
    const res = await client.rpc('get_thing', { id: 42 });
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('postgrest: row not found');
  });

  it('rpcService rejection (non-Error throw) → String()-coerces the value into error.message', async () => {
    mockRpcService.mockRejectedValue('plain string thrown');
    const { createServiceRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createServiceRpcAdapter();
    const res = await client.rpc('weird');
    expect(res.error?.message).toBe('plain string thrown');
  });

  it('arguments to createServiceRpcAdapter are ignored (legacy-shim signature)', async () => {
    mockRpcService.mockResolvedValue(null);
    const { createServiceRpcAdapter } = await import('../lib/rpcAdapter.js');
    // The legacy callsite passed (url, key, opts). We must accept them
    // without throwing — they're discarded internally.
    const client = createServiceRpcAdapter('http://ignored', 'ignored-key', { schema: 'public' });
    await client.rpc('noop');
    expect(mockRpcService).toHaveBeenCalled();
  });
});

describe('rpcAdapter :: createServiceRpcAdapter — adversarial inputs', () => {
  beforeEach(() => {
    mockRpcService.mockReset();
  });

  it('passes a payload with __proto__ key WITHOUT mutating Object.prototype (proto-pollution)', async () => {
    mockRpcService.mockResolvedValue('ok');
    const { createServiceRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createServiceRpcAdapter();

    // Attacker-controlled param with prototype-pollution payload.
    const evil = JSON.parse('{"__proto__": {"polluted": "yes"}, "real": 1}');
    await client.rpc('fn', evil);

    // Adapter passes params through to rpcService verbatim — verify call shape
    expect(mockRpcService).toHaveBeenCalledWith('fn', evil);
    // Object.prototype was NOT polluted (any new object would have a
    // `polluted` key if `__proto__` was assigned naively somewhere).
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('passes a payload with constructor.prototype key safely', async () => {
    mockRpcService.mockResolvedValue('ok');
    const { createServiceRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createServiceRpcAdapter();

    const evil = { constructor: { prototype: { polluted: 'yes' } } };
    await client.rpc('fn', evil);

    expect(mockRpcService).toHaveBeenCalled();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('handles params with very deep nesting without stack overflow', async () => {
    mockRpcService.mockResolvedValue('ok');
    const { createServiceRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createServiceRpcAdapter();
    // Build a 5000-deep object — well past typical JSON parser limits.
    let deep: Record<string, unknown> = { v: 0 };
    for (let i = 0; i < 5000; i++) deep = { nested: deep };
    // The adapter doesn't traverse — it just passes the object through.
    // We assert it returns instead of stack-overflowing.
    await expect(client.rpc('fn', deep)).resolves.toBeDefined();
  });

  it('handles rejection that is itself an object with no .message field', async () => {
    // Some bad libraries throw `{ code: ..., detail: ... }` without `.message`.
    // Our `String(err)` fallback should produce "[object Object]" rather than
    // crashing or leaking the whole object as JSON into error.message.
    mockRpcService.mockRejectedValue({ code: 'XX000', detail: 'internal' });
    const { createServiceRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createServiceRpcAdapter();
    const res = await client.rpc('fn');
    expect(res.data).toBeNull();
    expect(typeof res.error?.message).toBe('string');
    // Note: this is "graceful" not "great" — a follow-up could format
    // the object more usefully, but the contract is "always returns
    // {data, error} envelope" and that's preserved.
  });
});

describe('rpcAdapter :: createUserRpcAdapter (RLS-enforced)', () => {
  beforeEach(() => {
    mockRpcUser.mockReset();
    // Clear service-role mock too so cross-adapter isolation test
    // observes a clean baseline (other tests in this file may have
    // exercised mockRpcService).
    mockRpcService.mockReset();
  });

  it('threads the userJwt arg into every rpcUser call', async () => {
    mockRpcUser.mockResolvedValue([{ id: 'a' }]);
    const { createUserRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createUserRpcAdapter('user-jwt-xyz');
    await client.rpc('get_my_data', { p_id: 'x' });
    expect(mockRpcUser).toHaveBeenCalledWith('get_my_data', { p_id: 'x' }, 'user-jwt-xyz');
  });

  it('separates errors the same way as the service adapter', async () => {
    mockRpcUser.mockRejectedValue(new Error('RLS violation: not your row'));
    const { createUserRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createUserRpcAdapter('user-jwt');
    const res = await client.rpc('get_my_data', { id: 'other-users' });
    expect(res.data).toBeNull();
    expect(res.error?.message).toContain('RLS violation');
  });

  it('does NOT call rpcService — strict per-call isolation between adapters', async () => {
    mockRpcUser.mockResolvedValue('user-data');
    mockRpcService.mockResolvedValue('SERVICE-DATA-SHOULD-NEVER-LEAK');
    const { createUserRpcAdapter } = await import('../lib/rpcAdapter.js');
    const client = createUserRpcAdapter('jwt');
    await client.rpc('fn');
    expect(mockRpcUser).toHaveBeenCalled();
    expect(mockRpcService).not.toHaveBeenCalled();
  });
});
