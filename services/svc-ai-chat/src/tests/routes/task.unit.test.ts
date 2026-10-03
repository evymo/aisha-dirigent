/**
 * Unit tests for the AI Task CRUD route (services/svc-ai-chat/src/routes/task.ts).
 *
 * Primary locked-in invariant (regression guard for the verifyToken contract):
 *   - POST /task forwards the acting user id to create_ai_task as
 *     `p_user_id`, sourced from the verified token's canonical `.userId`
 *     (the JWT sub claim), NOT the dropped `.sub` field. Under the old
 *     `user.sub` read this was `undefined`, silently relying on the RPC's
 *     auth.uid() COALESCE fallback.
 *
 * Secondary invariants:
 *   - 401 when verifyToken throws AuthError
 *   - 400 when task_type is missing or not in the allow-list
 *   - GET /task?task_id rejects non-UUID values (400)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpcUser, mockVerifyToken } = vi.hoisted(() => ({
  mockRpcUser: vi.fn(),
  mockVerifyToken: vi.fn(),
}));

vi.mock('../../postgrest.js', () => ({
  rpcUser: mockRpcUser,
  rpcService: vi.fn(),
}));

vi.mock('../../auth.js', () => ({
  verifyToken: mockVerifyToken,
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
    }
  },
}));

type Handler = (req: unknown, reply: unknown) => Promise<unknown> | unknown;
function makeApp() {
  const handlers = new Map<string, Handler>();
  const post = vi.fn((path: string, h: Handler) => handlers.set(`POST ${path}`, h));
  const get = vi.fn((path: string, h: Handler) => handlers.set(`GET ${path}`, h));
  const del = vi.fn((path: string, h: Handler) => handlers.set(`DELETE ${path}`, h));
  return {
    app: { post, get, delete: del } as unknown as Parameters<
      typeof import('../../routes/task.js').taskRoutes
    >[0],
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

async function call(
  method: 'POST' | 'GET' | 'DELETE',
  body?: unknown,
  query?: unknown,
  authHeader: string | undefined = 'Bearer valid-token',
) {
  const { taskRoutes } = await import('../../routes/task.js');
  const { app, handlers } = makeApp();
  await taskRoutes(app);
  const { reply, calls } = makeReply();
  const handler = handlers.get(`${method} /task`)!;
  await handler({ headers: { authorization: authHeader }, body, query }, reply);
  return calls;
}

beforeEach(() => {
  mockRpcUser.mockReset();
  mockVerifyToken.mockReset();
});

describe('taskRoutes :: POST /task', () => {
  it('forwards p_user_id from the verified token .userId (NOT .sub)', async () => {
    mockVerifyToken.mockResolvedValue({
      userId: 'user-uuid-trusted',
      roles: [],
      claims: { sub: 'user-uuid-trusted' },
    });
    mockRpcUser.mockResolvedValue({ task_id: 't-1', status: 'queued' });

    const calls = await call('POST', { task_type: 'batch_analysis' });

    expect(calls.code).toBe(201);
    const createCall = mockRpcUser.mock.calls.find(([fn]) => fn === 'create_ai_task');
    expect(createCall, 'create_ai_task must be called').toBeDefined();
    const params = createCall![1] as { p_user_id: unknown };
    expect(params.p_user_id).toBe('user-uuid-trusted');
    // Regression guard: the old `user.sub` read produced undefined here.
    expect(params.p_user_id).not.toBeUndefined();
  });

  it('passes the bearer token through as the rpcUser JWT', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [], claims: {} });
    mockRpcUser.mockResolvedValue({ task_id: 't-2', status: 'queued' });

    await call('POST', { task_type: 'data_export' }, undefined, 'Bearer the-jwt');

    const createCall = mockRpcUser.mock.calls.find(([fn]) => fn === 'create_ai_task');
    expect(createCall![2]).toBe('the-jwt');
  });

  it('401 when verifyToken throws AuthError', async () => {
    const { AuthError } = await import('../../auth.js');
    mockVerifyToken.mockRejectedValue(new AuthError(401, 'expired'));
    const calls = await call('POST', { task_type: 'batch_analysis' });
    expect(calls.code).toBe(401);
    expect(calls.body).toEqual({ error: 'Unauthorized' });
    expect(mockRpcUser).not.toHaveBeenCalled();
  });

  it('400 when task_type is missing or not in the allow-list', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [], claims: {} });
    const missing = await call('POST', {});
    expect(missing.code).toBe(400);
    const bogus = await call('POST', { task_type: 'rm_rf_slash' });
    expect(bogus.code).toBe(400);
    expect(mockRpcUser).not.toHaveBeenCalled();
  });
});

describe('taskRoutes :: GET /task', () => {
  it('400 when task_id query param is not a valid UUID', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [], claims: {} });
    const calls = await call('GET', undefined, { task_id: 'not-a-uuid' });
    expect(calls.code).toBe(400);
    expect(mockRpcUser).not.toHaveBeenCalled();
  });
});
