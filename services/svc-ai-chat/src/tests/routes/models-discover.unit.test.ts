/**
 * Unit tests for POST /models/discover (services/svc-ai-chat/src/routes/models.ts).
 *
 * Invariants:
 *   - admin/staff (403 for a normal user, 401 on an invalid token) OR the service token
 *     (cold-start vyžádá discovery, když čeká na model — C6)
 *   - admin → runs the discover→self-test pipeline and returns the summary + audits it
 *   - a targeted {provider} limits discovery to that one backend family
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpcService, mockVerifyToken, mockVerifyServiceRole, mockIsAdmin, mockDiscover, mockSelfTest, mockGetAllBackends } = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockVerifyServiceRole: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockDiscover: vi.fn(),
  mockSelfTest: vi.fn(),
  mockGetAllBackends: vi.fn(),
}));

class AuthErrorMock extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

vi.mock('../../postgrest.js', () => ({ rpcService: mockRpcService, rpcUser: vi.fn() }));
vi.mock('../../auth.js', () => ({
  verifyToken: mockVerifyToken,
  verifyServiceRole: mockVerifyServiceRole,
  isAdminOrStaff: mockIsAdmin,
  AuthError: AuthErrorMock,
}));
vi.mock('../../lib/modelDiscovery.js', () => ({ discoverModels: mockDiscover }));
vi.mock('../../lib/modelSelfTest.js', () => ({ selfTestModels: mockSelfTest }));
vi.mock('../../lib/llmRouter.js', () => ({ getAllBackends: mockGetAllBackends }));
vi.mock('../../config.js', () => ({ config: { chatModelPrefixes: ['gpt-'], openaiApiKey: 'sk-x' } }));

type Handler = (req: unknown, reply: unknown) => Promise<unknown> | unknown;
function makeApp() {
  const handlers = new Map<string, Handler>();
  const post = vi.fn((path: string, h: Handler) => handlers.set(`POST ${path}`, h));
  const get = vi.fn((path: string, h: Handler) => handlers.set(`GET ${path}`, h));
  return {
    app: { post, get } as unknown as Parameters<typeof import('../../routes/models.js').modelsRoutes>[0],
    handlers,
  };
}
function makeReply() {
  const calls: { code: number | null; body: unknown } = { code: null, body: undefined };
  const reply = {
    code(c: number) { calls.code = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}
async function call(body?: unknown, authHeader: string | undefined = 'Bearer valid') {
  const { modelsRoutes } = await import('../../routes/models.js');
  const { app, handlers } = makeApp();
  await modelsRoutes(app);
  const { reply, calls } = makeReply();
  const handler = handlers.get('POST /models/discover')!;
  await handler({ headers: { authorization: authHeader }, body }, reply);
  return calls;
}

beforeEach(() => {
  mockRpcService.mockReset();
  mockVerifyToken.mockReset();
  mockVerifyServiceRole.mockReset();
  // Výchozí: hlavička NENÍ servisní token (jako u každého uživatelského JWT).
  mockVerifyServiceRole.mockImplementation(() => {
    throw new AuthErrorMock(403, 'Invalid service role token');
  });
  mockIsAdmin.mockReset();
  mockDiscover.mockReset();
  mockSelfTest.mockReset();
  mockGetAllBackends.mockReset();
  mockGetAllBackends.mockReturnValue([{ id: 'openai' }, { id: 'google' }]);
  mockRpcService.mockResolvedValue(null);
});

describe('modelsRoutes :: POST /models/discover', () => {
  it('403 for a non-admin user — never runs discovery', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [] });
    mockIsAdmin.mockReturnValue(false);
    const calls = await call({});
    expect(calls.code).toBe(403);
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it('401 when the token is invalid (AuthError statusCode honoured)', async () => {
    mockVerifyToken.mockRejectedValue(new AuthErrorMock(401, 'bad token'));
    const calls = await call({}, 'Bearer bad');
    expect(calls.code).toBe(401);
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it('admin → runs discover + self-test and returns the summary + audits it', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'admin-1' });
    mockIsAdmin.mockReturnValue(true);
    mockDiscover.mockResolvedValue({ discovered: 3, perProvider: { openai: 3 }, errors: [] });
    mockSelfTest.mockResolvedValue({ tested: 3, passed: 2, failed: 1 });

    const calls = await call({});

    expect(mockDiscover).toHaveBeenCalledTimes(1);
    expect(mockSelfTest).toHaveBeenCalledTimes(1);
    expect(calls.body).toMatchObject({ discovered: 3, tested: 3, passed: 2, failed: 1 });
    expect(mockRpcService.mock.calls.some(([fn]) => fn === 'log_audit_event')).toBe(true);
  });

  it('targeted {provider} limits discovery to that one backend family', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'admin-1' });
    mockIsAdmin.mockReturnValue(true);
    mockDiscover.mockResolvedValue({ discovered: 1, perProvider: { openai: 1 }, errors: [] });
    mockSelfTest.mockResolvedValue({ tested: 1, passed: 1, failed: 0 });

    await call({ provider: 'openai' });

    const backendsArg = mockDiscover.mock.calls[0][1];
    expect(backendsArg).toEqual([{ id: 'openai' }]);
  });

  // ⛔ C6 (2026-09-13): cold-start čekal na model podle periody discovery (15 min).
  it('servisní token → discovery bez uživatele; KC token se vůbec neověřuje; audit nese lane', async () => {
    mockVerifyServiceRole.mockImplementation(() => undefined);
    mockDiscover.mockResolvedValue({ discovered: 1, perProvider: { vllm: 1 }, errors: [] });
    mockSelfTest.mockResolvedValue({ tested: 1, passed: 1, failed: 0 });

    const calls = await call({}, 'Bearer service-token');

    expect(calls.code).toBeNull();
    expect(mockVerifyToken).not.toHaveBeenCalled();
    expect(mockDiscover).toHaveBeenCalledTimes(1);
    const audit = mockRpcService.mock.calls.find(([fn]) => fn === 'log_audit_event')?.[1] as Record<string, unknown>;
    expect(audit.p_user_id).toBeNull();
    expect(audit.p_metadata).toMatchObject({ lane: 'service', self_test: true });
  });

  it('selfTest:false → jen discovery, self-test neběží a odpověď to říká', async () => {
    mockVerifyServiceRole.mockImplementation(() => undefined);
    mockDiscover.mockResolvedValue({ discovered: 2, perProvider: { vllm: 2 }, errors: [] });

    const calls = await call({ selfTest: false }, 'Bearer service-token');

    expect(mockDiscover).toHaveBeenCalledTimes(1);
    expect(mockSelfTest).not.toHaveBeenCalled();
    expect(calls.body).toMatchObject({ discovered: 2, tested: 0, selfTestRan: false });
  });

  it('⛔ negativní sonda: neservisní token s ne-adminem discovery nespustí; nesmyslné selfTest je 400', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [] });
    mockIsAdmin.mockReturnValue(false);
    expect((await call({}, 'Bearer jiny')).code).toBe(403);
    expect(mockDiscover).not.toHaveBeenCalled();

    mockVerifyServiceRole.mockImplementation(() => undefined);
    expect((await call({ selfTest: 'ne' }, 'Bearer service-token')).code).toBe(400);
    expect((await call({ mode: 'rejected-only', selfTest: false }, 'Bearer service-token')).code).toBe(400);
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it('re-test mode SKIPS discovery, runs self-test with the mode, audits MODELS_RETEST_TRIGGERED', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'admin-1' });
    mockIsAdmin.mockReturnValue(true);
    mockSelfTest.mockResolvedValue({ tested: 2, passed: 1, failed: 1 });

    const calls = await call({ mode: 'rejected-only' });

    expect(mockDiscover, 'discovery must be skipped on re-test').not.toHaveBeenCalled();
    // self-test ran with the mode threaded through opts (3rd arg).
    expect(mockSelfTest).toHaveBeenCalledTimes(1);
    expect(mockSelfTest.mock.calls[0][2]).toMatchObject({ mode: 'rejected-only' });
    expect(calls.body).toMatchObject({ discovered: 0, tested: 2 });
    const audit = mockRpcService.mock.calls.find(([fn]) => fn === 'log_audit_event');
    expect((audit?.[1] as { p_action: string }).p_action).toBe('MODELS_RETEST_TRIGGERED');
  });
});
