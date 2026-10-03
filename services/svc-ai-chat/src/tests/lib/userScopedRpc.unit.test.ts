/**
 * lib/userScopedRpc — the RFC 8693 on-behalf-of mint for user-scoped PostgREST
 * RPCs (the identity spine of the legacy /chat surface fix).
 *
 * Contract under test:
 *  - the minted token is a valid HS256 JWT signed with JWT_SECRET whose
 *    sub=<verified user> and role='authenticated' (NEVER service_role),
 *  - createUserScopedRpcAdapter threads that token into rpcUser for every call,
 *  - minting FAILS LOUD (throws) when the secret or user id is missing —
 *    no silent service_role substitution.
 *
 * config.js reads env at import time, so each test reloads the module graph
 * (vi.resetModules + dynamic import) with the env it needs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

const rpcUserMock = vi.fn(async () => null);
const rpcServiceMock = vi.fn(async () => null);
vi.mock('../../postgrest.js', () => ({
  rpcUser: (...args: unknown[]) => rpcUserMock(...(args as [])),
  rpcService: (...args: unknown[]) => rpcServiceMock(...(args as [])),
}));

const TEST_SECRET = 'unit-test-hs256';

function decodeToken(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signed: string; sig: string } {
  const [h, p, sig] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
    signed: `${h}.${p}`,
    sig,
  };
}

async function loadModule(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return await import('../../lib/userScopedRpc.js');
}

describe('mintUserScopedPostgrestToken', () => {
  const envBackup: Record<string, string | undefined> = {};
  beforeEach(() => {
    envBackup.JWT_SECRET = process.env.JWT_SECRET;
    envBackup.POSTGREST_JWT_SECRET = process.env.POSTGREST_JWT_SECRET;
    rpcUserMock.mockClear();
    rpcServiceMock.mockClear();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('mints an HS256 JWT with sub=<user>, role=authenticated, signed with JWT_SECRET', async () => {
    const mod = await loadModule({ JWT_SECRET: TEST_SECRET, POSTGREST_JWT_SECRET: undefined });
    const token = mod.mintUserScopedPostgrestToken({ userId: 'user-abc', tokenUse: 'chat-user-rpc' });

    const { header, payload, signed, sig } = decodeToken(token);
    expect(header).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    expect(payload.sub).toBe('user-abc');
    expect(payload.role).toBe('authenticated'); // load-bearing: never service_role
    expect(payload.token_use).toBe('chat-user-rpc');
    expect(payload.story_id).toBeNull();
    expect((payload.exp as number) - (payload.iat as number)).toBe(15 * 60);

    const expected = createHmac('sha256', TEST_SECRET).update(signed).digest('base64url');
    expect(sig).toBe(expected);
  });

  it('carries an explicit story binding when provided', async () => {
    const mod = await loadModule({ JWT_SECRET: TEST_SECRET });
    const token = mod.mintUserScopedPostgrestToken({ userId: 'u1', storyId: 's1', tokenUse: 'omni-mcp-mediation' });
    expect(decodeToken(token).payload.story_id).toBe('s1');
  });

  it('THROWS (fail-loud) when no signing secret is configured', async () => {
    const mod = await loadModule({ JWT_SECRET: undefined, POSTGREST_JWT_SECRET: undefined });
    expect(() => mod.mintUserScopedPostgrestToken({ userId: 'u1', tokenUse: 'chat-user-rpc' }))
      .toThrow(/JWT_SECRET/);
  });

  it('THROWS (fail-loud) when there is no verified user id', async () => {
    const mod = await loadModule({ JWT_SECRET: TEST_SECRET });
    expect(() => mod.mintUserScopedPostgrestToken({ userId: '', tokenUse: 'chat-user-rpc' }))
      .toThrow(/no verified user id/);
  });
});

describe('createUserScopedRpcAdapter', () => {
  it('threads the minted user token into rpcUser for every call (never rpcService)', async () => {
    const mod = await loadModule({ JWT_SECRET: TEST_SECRET });
    const adapter = mod.createUserScopedRpcAdapter('user-xyz', 'chat-user-rpc');

    rpcUserMock.mockResolvedValueOnce({ ok: true } as never);
    const { data, error } = await adapter.rpc('get_chat_access_level', { p_user_id: 'user-xyz' });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(rpcServiceMock).not.toHaveBeenCalled();
    expect(rpcUserMock).toHaveBeenCalledTimes(1);
    const [fn, params, jwt] = rpcUserMock.mock.calls[0] as unknown as [string, Record<string, unknown>, string];
    expect(fn).toBe('get_chat_access_level');
    expect(params).toEqual({ p_user_id: 'user-xyz' });
    const { payload } = decodeToken(jwt);
    expect(payload.sub).toBe('user-xyz');
    expect(payload.role).toBe('authenticated');
  });

  it('propagates minting failure as a throw at adapter-construction time', async () => {
    const mod = await loadModule({ JWT_SECRET: undefined, POSTGREST_JWT_SECRET: undefined });
    expect(() => mod.createUserScopedRpcAdapter('user-xyz', 'chat-user-rpc')).toThrow(/JWT_SECRET/);
  });
});

describe('mintMcpUserToken delegation (Omni /v1 lane unchanged)', () => {
  it('keeps the fail-closed NULL contract and the omni-mcp-mediation token_use', async () => {
    vi.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;
    const proxy = await import('../../lib/mcpToolProxy.js');
    const token = proxy.mintMcpUserToken('user-1', 'story-1');
    expect(token).not.toBeNull();
    const { payload } = decodeToken(token as string);
    expect(payload).toMatchObject({ sub: 'user-1', story_id: 'story-1', role: 'authenticated', token_use: 'omni-mcp-mediation' });
    expect(proxy.mintMcpUserToken(null, 'story-1')).toBeNull();

    vi.resetModules();
    delete process.env.JWT_SECRET;
    delete process.env.POSTGREST_JWT_SECRET;
    const proxyNoSecret = await import('../../lib/mcpToolProxy.js');
    expect(proxyNoSecret.mintMcpUserToken('user-1', 'story-1')).toBeNull();
  });
});
