/**
 * POST /chat — user-scoped RPC identity threading (mock PostgREST at the
 * rpcService/rpcUser seam, so the REAL adapter wiring in routes/chat.ts is
 * exercised).
 *
 * Proves the three contract points of the fix:
 *  1. An AUTHENTICATED call runs every auth.uid()-gated RPC (access level,
 *     conversation create/read, user-message save, story resolution) through
 *     rpcUser with a minted HS256 token carrying sub=<verified user> and
 *     role=authenticated — NOT the service_role token (whose missing `sub`
 *     made auth.uid() NULL and 500'd the definer RPCs before the fix).
 *  2. An UNAUTHENTICATED call to the user-scoped path errors (401) without a
 *     single user-plane RPC — no silent service_role substitution.
 *  3. Service-plane calls are unchanged: the orchestration RPCs still go out
 *     via rpcService, and none of the user-scoped functions leak onto it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';

const TEST_SECRET = 'route-test-hs256';
const USER_ID = '11111111-1111-1111-1111-111111111111';

// Env must exist BEFORE the module graph (config.js reads env at import time).
vi.hoisted(() => {
  process.env.JWT_SECRET = 'route-test-hs256';
});

// Čtečka pověření (2026-10-02): v testu trezor = prostředí procesu (tvar createCredentialReader).
vi.mock('../../lib/credentials.js', () => ({
  credentials: {
    get: async (n: string) => process.env[n] ?? null,
    getMany: async (ns: readonly string[]) => Object.fromEntries(ns.map((n) => [n, process.env[n] ?? null])),
    migrateEnvCredentials: async () => ({ moved: [], kept: [], absent: [], failed: [] }),
    invalidate: () => undefined,
  },
  POVERENI_Z_PROSTREDI: [],
}));
vi.mock('../../auth.js', () => {
  class AuthError extends Error {
    constructor(public statusCode: number, message: string) {
      super(message);
      this.name = 'AuthError';
    }
  }
  return { verifyToken: vi.fn(), AuthError };
});

// PostgREST seam: rpcService = service_role plane, rpcUser = caller plane.
vi.mock('../../postgrest.js', () => ({ rpcService: vi.fn(), rpcUser: vi.fn() }));

// Registry probe (step 3) must not hit the network in a unit test.
vi.mock('@aisha/llm-dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aisha/llm-dispatch')>();
  return {
    ...actual,
    getRegistry: () => ({
      hasAnyAvailableBackend: async () => true,
      diagnostics: async () => [],
    }),
  };
});

import { chatRoutes } from '../../routes/chat.js';
import { verifyToken } from '../../auth.js';
import { rpcService, rpcUser } from '../../postgrest.js';

const verifyTokenMock = verifyToken as unknown as ReturnType<typeof vi.fn>;
const rpcServiceMock = rpcService as unknown as ReturnType<typeof vi.fn>;
const rpcUserMock = rpcUser as unknown as ReturnType<typeof vi.fn>;

/** RPCs whose SECURITY DEFINER bodies gate on auth.uid() — MUST be caller-scoped. */
const USER_SCOPED_FNS = [
  'get_chat_access_level',
  'create_chat_conversation_audited',
  'get_chat_messages_audited',
  'get_chat_context_story_id',
] as const;

function decodePayload(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
}

function installUserPlaneResponses() {
  rpcUserMock.mockImplementation(async (fn: string) => {
    switch (fn) {
      case 'get_chat_access_level':
        return { access_level: 'active', can_chat: true, block_reason: null };
      case 'create_chat_conversation_audited':
        return { conversation_id: '22222222-2222-2222-2222-222222222222' };
      case 'get_chat_messages_audited':
        return [];
      case 'save_chat_message_audited':
        return { id: '33333333-3333-3333-3333-333333333333' };
      case 'get_chat_context_story_id':
        return null;
      default:
        return null;
    }
  });
}

async function buildApp() {
  const app = Fastify();
  await app.register(chatRoutes);
  await app.ready();
  return app;
}

describe('POST /chat user-scoped RPC identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Service plane: everything answers null; the channel-config load therefore
    // fails (fail-loud 500) which ends the request AFTER all user-plane RPCs of
    // interest have run — a deterministic early exit for the unit test.
    rpcServiceMock.mockResolvedValue(null);
  });

  it('authenticated call carries the CALLER identity on every auth.uid()-gated RPC', async () => {
    verifyTokenMock.mockResolvedValue({ userId: USER_ID, roles: [], claims: { sub: USER_ID } });
    installUserPlaneResponses();

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: 'Bearer kc-rs256-token' },
      payload: { message: 'hello there' },
    });
    await app.close();

    // Deterministic exit point: channel config unavailable → fail-loud 500,
    // which means the handler got PAST all user-scoped RPC calls.
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('Failed to load agent configurations');

    const userCalls = rpcUserMock.mock.calls as Array<[string, Record<string, unknown>, string]>;
    const userFnNames = userCalls.map(([fn]) => fn);
    for (const fn of USER_SCOPED_FNS) {
      expect(userFnNames, `${fn} must run on the USER plane`).toContain(fn);
    }
    // The user's own message is saved under the caller identity too.
    const userSave = userCalls.find(([fn, params]) => fn === 'save_chat_message_audited' && params.p_role === 'user');
    expect(userSave, 'user-message save must run on the USER plane').toBeTruthy();

    // Every user-plane call carries the SAME minted token: sub=<verified user>,
    // role=authenticated, HMAC-valid under JWT_SECRET.
    const tokens = new Set(userCalls.map(([, , jwt]) => jwt));
    expect(tokens.size).toBe(1);
    const token = [...tokens][0];
    const [h, p, sig] = token.split('.');
    expect(sig).toBe(createHmac('sha256', TEST_SECRET).update(`${h}.${p}`).digest('base64url'));
    const payload = decodePayload(token);
    expect(payload.sub).toBe(USER_ID);
    expect(payload.role).toBe('authenticated');
    expect(payload.token_use).toBe('chat-user-rpc');

    // Service plane is deliberate and unchanged: orchestration RPCs go out on
    // rpcService, and NO user-scoped function leaks onto the service plane.
    const serviceFnNames = (rpcServiceMock.mock.calls as Array<[string]>).map(([fn]) => fn);
    expect(serviceFnNames).toContain('create_ai_run'); // tracer (platform-owned observability)
    expect(serviceFnNames).toContain('get_active_channel_config'); // platform catalog
    for (const fn of USER_SCOPED_FNS) {
      expect(serviceFnNames, `${fn} must NOT run as service_role`).not.toContain(fn);
    }
    expect(
      serviceFnNames.filter((fn) => fn === 'save_chat_message_audited'),
      'no service-plane message save before the assistant turn',
    ).toHaveLength(0);
  });

  it('unauthenticated call (no Authorization header) errors 401 with ZERO user-plane RPCs', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/chat', payload: { message: 'hi' } });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(rpcUserMock).not.toHaveBeenCalled();
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('invalid token errors 401 with ZERO user-plane RPCs (no service_role substitution)', async () => {
    verifyTokenMock.mockRejectedValue(new Error('Invalid token'));

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: 'Bearer forged' },
      payload: { message: 'hi' },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(rpcUserMock).not.toHaveBeenCalled();
  });
});
