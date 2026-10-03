/**
 * Unit tests for the proactive-trigger route
 * (services/svc-ai-chat/src/routes/proactive.ts).
 *
 * The route is the HTTP entry into lib/proactiveEngine.ts (whose RPCs —
 * get_active_triggers_for_source, check_trigger_cooldown, save_proactive_run,
 * get_agent_catalog_entry — all exist in aisha/db/sql/functions). It previously
 * called three RPCs that were NEVER defined in this repo's schema
 * (proactive_evaluate_triggers / proactive_get_stats / proactive_get_my_stats),
 * so every call 500'd with PGRST202; these tests lock in the honest wiring.
 *
 * Primary locked-in invariants:
 *   - USER path (Bearer JWT): the acting user id passed to the engine is the
 *     verified token's canonical `.userId` (the JWT sub claim) — NEVER the
 *     request body (no identity injection).
 *   - SERVICE path: user_id comes from the request body and is REQUIRED
 *     (fail-loud 400, never a null-user engine run).
 *   - stats is SERVICE-ROLE ONLY (admin-scoped RPCs behind it) — a plain user
 *     gets 403, never platform-wide numbers.
 *   - An engine failure surfaces as 500 (fail-loud), never a fabricated
 *     { triggered: false } success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCreateProactiveEngine,
  mockEvaluateSource,
  mockGetStats,
  mockVerifyToken,
  mockVerifyServiceRole,
  mockCreateTracer,
  mockCreateServiceRpcAdapter,
} = vi.hoisted(() => {
  const evaluateSource = vi.fn();
  const getStats = vi.fn();
  return {
    mockEvaluateSource: evaluateSource,
    mockGetStats: getStats,
    mockCreateProactiveEngine: vi.fn(() => ({ evaluateSource, getStats })),
    mockVerifyToken: vi.fn(),
    mockVerifyServiceRole: vi.fn(),
    mockCreateTracer: vi.fn(async () => ({
      finish: vi.fn(async () => undefined),
      span: vi.fn(),
      runId: null,
    })),
    mockCreateServiceRpcAdapter: vi.fn(() => ({ rpc: vi.fn() })),
  };
});

vi.mock('../../lib/proactiveEngine.js', () => ({
  createProactiveEngine: mockCreateProactiveEngine,
}));
vi.mock('../../lib/tracer.js', () => ({
  createTracer: mockCreateTracer,
}));
vi.mock('../../lib/rpcAdapter.js', () => ({
  createServiceRpcAdapter: mockCreateServiceRpcAdapter,
  createUserRpcAdapter: vi.fn(),
}));
vi.mock('../../auth.js', () => ({
  verifyToken: mockVerifyToken,
  verifyServiceRole: mockVerifyServiceRole,
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
  return {
    app: { post } as unknown as Parameters<typeof import('../../routes/proactive.js').proactiveRoutes>[0],
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

async function call(body: unknown, authHeader: string) {
  const { proactiveRoutes } = await import('../../routes/proactive.js');
  const { app, handlers } = makeApp();
  await proactiveRoutes(app);
  const { reply, calls } = makeReply();
  const handler = handlers.get('POST /proactive')!;
  await handler({ headers: { authorization: authHeader }, body, log: { error: vi.fn() } }, reply);
  return calls;
}

// USER path requires the header to start with 'Bearer ey' (JWT shape).
const USER_JWT = 'Bearer eyJ-fake-user-jwt';
const SERVICE_TOKEN = 'Bearer service-role-secret';

const EVALUATE_BODY = {
  action: 'evaluate',
  source_table: 'health_check_ins',
  source_event: 'INSERT',
  record_data: { pain_level: 8 },
  source_record_id: 'rec-1',
};

beforeEach(() => {
  mockEvaluateSource.mockReset().mockResolvedValue([]);
  mockGetStats.mockReset().mockResolvedValue({ activeTriggers: 2, runsToday: 5 });
  mockVerifyToken.mockReset();
  mockVerifyServiceRole.mockReset();
  mockCreateProactiveEngine.mockClear();
});

describe('proactiveRoutes :: POST /proactive (user JWT path)', () => {
  it('evaluate → engine userId is the verified token .userId (NOT the body)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-uuid-trusted', roles: [], claims: {} });

    const calls = await call({ ...EVALUATE_BODY, user_id: 'attacker-injected' }, USER_JWT);

    expect(calls.code).toBeNull(); // reply.send without explicit code = 200
    expect(mockEvaluateSource).toHaveBeenCalledOnce();
    const input = mockEvaluateSource.mock.calls[0][0] as { userId: string; sourceTable: string; sourceEvent: string };
    expect(input.userId).toBe('user-uuid-trusted');
    expect(input.userId).not.toBe('attacker-injected');
    expect(input.sourceTable).toBe('health_check_ins');
    expect(input.sourceEvent).toBe('INSERT');
  });

  it('evaluate → 400 when source_table or source_event is missing (fail-loud, no engine call)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [], claims: {} });
    const calls = await call({ action: 'evaluate', source_event: 'INSERT' }, USER_JWT);
    expect(calls.code).toBe(400);
    expect(mockEvaluateSource).not.toHaveBeenCalled();
  });

  it('evaluate → 400 on an unknown source_event (reject unexpected shapes)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [], claims: {} });
    const calls = await call({ ...EVALUATE_BODY, source_event: 'TRUNCATE' }, USER_JWT);
    expect(calls.code).toBe(400);
    expect(mockEvaluateSource).not.toHaveBeenCalled();
  });

  it('evaluate → triggered=true only when a trigger really matched without a skip/error', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [], claims: {} });
    mockEvaluateSource.mockResolvedValue([
      { triggerId: 't1', triggerName: 'a', matched: true, skippedReason: 'cooldown' },
      { triggerId: 't2', triggerName: 'b', matched: true, actionTaken: 'alert_generated' },
    ]);
    const calls = await call(EVALUATE_BODY, USER_JWT);
    const body = calls.body as { result: { triggered: boolean; trigger_count: number } };
    expect(body.result.triggered).toBe(true);
    expect(body.result.trigger_count).toBe(2);
  });

  it('evaluate → 500 when the engine throws (fail-loud, never a fabricated success)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [], claims: {} });
    mockEvaluateSource.mockRejectedValue(new Error('db down'));
    const calls = await call(EVALUATE_BODY, USER_JWT);
    expect(calls.code).toBe(500);
  });

  it('stats → 403 for a plain user (admin-scoped RPCs behind it; no per-user stats RPC exists)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [], claims: {} });
    const calls = await call({ action: 'stats' }, USER_JWT);
    expect(calls.code).toBe(403);
    expect(mockGetStats).not.toHaveBeenCalled();
  });
});

describe('proactiveRoutes :: POST /proactive (service-role path)', () => {
  it('evaluate → engine userId comes from the request body user_id', async () => {
    const calls = await call({ ...EVALUATE_BODY, user_id: 'on-behalf-user' }, SERVICE_TOKEN);
    expect(calls.code).toBeNull();
    expect(mockVerifyServiceRole).toHaveBeenCalled();
    expect(mockVerifyToken).not.toHaveBeenCalled();
    const input = mockEvaluateSource.mock.calls[0][0] as { userId: string };
    expect(input.userId).toBe('on-behalf-user');
  });

  it('evaluate → 400 when user_id is missing (engine must never run for a null user)', async () => {
    const calls = await call(EVALUATE_BODY, SERVICE_TOKEN);
    expect(calls.code).toBe(400);
    expect(mockEvaluateSource).not.toHaveBeenCalled();
  });

  it('stats → returns the engine stats', async () => {
    const calls = await call({ action: 'stats' }, SERVICE_TOKEN);
    expect(calls.code).toBeNull();
    expect(mockGetStats).toHaveBeenCalledOnce();
    expect(calls.body).toEqual({ action: 'stats', stats: { activeTriggers: 2, runsToday: 5 } });
  });
});

describe('proactiveRoutes :: shared guards', () => {
  it('400 on an unknown action', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [], claims: {} });
    const calls = await call({ action: 'self-destruct' }, USER_JWT);
    expect(calls.code).toBe(400);
  });

  it('401 when neither a JWT nor a valid service token is presented', async () => {
    mockVerifyServiceRole.mockImplementation(() => {
      throw new Error('bad token');
    });
    const calls = await call({ action: 'stats' }, 'Bearer nonsense');
    expect(calls.code).toBe(401);
  });
});
