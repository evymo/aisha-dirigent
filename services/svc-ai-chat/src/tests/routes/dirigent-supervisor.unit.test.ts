/**
 * Unit tests for POST /dirigent/dispatch (services/svc-ai-chat/src/routes/dirigent-supervisor.ts).
 *
 * Locked-in invariants:
 *   1. Missing/invalid bearer → 200 {} (cold-start parity, relay exits silent)
 *   2. Invalid event name → 400 with valid event list
 *   3. dispatch RPC failure → still drain nudges (if story_id) → 200 with
 *      additionalContext from drained nudges only
 *   4. dispatch + drain succeed, n8n unreachable → 200 with drained nudges
 *      only (no playbook advisory leaked)
 *   5. dispatch + drain + n8n all succeed → additionalContext = nudges +
 *      n8n advisory
 *   6. goal_evaluator playbook MAY return decision != allow → forwarded to relay
 *   7. Non-goal-evaluator playbooks' decision != allow → STRIPPED from reply
 *      (only goal_evaluator may force loop continuation per README contract)
 *   8. user_id passed to dispatch RPC comes from verified JWT's sub, NOT from
 *      request body (AITG-APP-04 input leakage closure)
 *   9. Audit log_integration_action fired best-effort (never blocks reply)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRpcService,
  mockSafeFetch,
  mockCreateSsrfGuard,
  mockVerifyToken,
} = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockSafeFetch: vi.fn(),
  mockCreateSsrfGuard: vi.fn(),
  mockVerifyToken: vi.fn(),
}));

mockCreateSsrfGuard.mockReturnValue({ safeFetch: mockSafeFetch });

vi.mock('@aisha/security', () => ({
  createSsrfGuard: mockCreateSsrfGuard,
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('../../config.js', () => ({
  config: {
    n8nBaseUrl: 'http://n8n:5678',
    n8nApiKey: 'test-n8n-key',
    ssrfHostAllowlist: 'n8n,localhost',
  },
}));

vi.mock('../../postgrest.js', () => ({
  rpcService: mockRpcService,
  rpcUser: vi.fn(),
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
  const post = vi.fn((path: string, handler: Handler) => handlers.set(`POST ${path}`, handler));
  return {
    app: { post } as unknown as Parameters<typeof import('../../routes/dirigent-supervisor.js').dirigentSupervisorRoutes>[0],
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

async function postDispatch(
  body: unknown,
  headers: Record<string, string> = { authorization: 'Bearer valid-token' },
) {
  const { dirigentSupervisorRoutes } = await import('../../routes/dirigent-supervisor.js');
  const { app, handlers } = makeApp();
  await dirigentSupervisorRoutes(app);
  const { reply, calls } = makeReply();
  const handler = handlers.get('POST /dirigent/dispatch')!;
  await handler({ body, headers }, reply);
  return calls;
}

beforeEach(() => {
  mockRpcService.mockReset();
  mockSafeFetch.mockReset();
  mockVerifyToken.mockReset();
});

describe('POST /dirigent/dispatch :: cold-start parity', () => {
  it('200 {} when verifyToken throws AuthError (no advisory, no block)', async () => {
    mockVerifyToken.mockRejectedValue(
      Object.assign(new Error('missing'), { statusCode: 401, name: 'AuthError' }),
    );
    // Real AuthError class is registered via vi.mock above so instanceof works
    const { AuthError } = await import('../../auth.js');
    mockVerifyToken.mockRejectedValue(new AuthError(401, 'missing'));
    const calls = await postDispatch({ event: 'session_start' });
    expect(calls.code).toBe(200);
    expect(calls.body).toEqual({});
  });

  it('400 on invalid event name', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-uuid-1' });
    const calls = await postDispatch({ event: 'not_a_real_event' });
    expect(calls.code).toBe(400);
    expect(calls.body).toMatchObject({ error: 'invalid_event' });
  });

  it('accepts all 5 valid event names', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-uuid-1' });
    mockRpcService.mockResolvedValue(null); // dispatch returns no playbook → degrade
    for (const event of ['session_start', 'prompt_submit', 'pre_tool', 'post_tool', 'stop']) {
      const calls = await postDispatch({ event });
      expect(calls.code, `event=${event}`).toBe(200);
    }
  });
});

describe('POST /dirigent/dispatch :: RPC + n8n integration', () => {
  beforeEach(() => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-uuid-trusted' });
  });

  it('passes user.userId (trusted JWT sub claim) NOT body input as p_payload.user_id', async () => {
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      playbook: 'briefing',
      priority: 1,
      event_logged: true,
    });
    mockRpcService.mockResolvedValueOnce([]); // drain
    mockSafeFetch.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );

    // Body includes a (untrusted) user_id field — must be IGNORED
    await postDispatch({ event: 'session_start', user_id: 'attacker-injected-id' });

    const dispatchCall = mockRpcService.mock.calls.find(
      ([fn]) => fn === 'dirigent_dispatch_event',
    );
    expect(dispatchCall).toBeDefined();
    const payload = dispatchCall![1].p_payload as { user_id: string };
    expect(payload.user_id).toBe('user-uuid-trusted'); // from JWT
    expect(payload.user_id).not.toBe('attacker-injected-id'); // body ignored
  });

  it('drain RPC params are alphabetical (service-security gate invariant)', async () => {
    mockRpcService.mockResolvedValueOnce(true); // is_story_participant -> owner
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      playbook: 'goal_evaluator',
      priority: 1,
      event_logged: true,
    });
    mockRpcService.mockResolvedValueOnce([]);
    mockSafeFetch.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    await postDispatch({ event: 'stop', story_id: 'story-1' });

    const drainCall = mockRpcService.mock.calls.find(
      ([fn]) => fn === 'dirigent_drain_nudges',
    );
    expect(drainCall).toBeDefined();
    expect(Object.keys(drainCall![1])).toEqual([
      'p_conversation_id',
      'p_limit',
      'p_story_id',
    ]);
  });

  it('composes additionalContext from drained nudges + n8n advisory', async () => {
    mockRpcService.mockResolvedValueOnce(true); // is_story_participant -> owner
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      playbook: 'goal_evaluator',
      priority: 1,
      event_logged: true,
    });
    mockRpcService.mockResolvedValueOnce([
      {
        id: 'n1',
        event_origin: 'compliance_engine',
        severity: 'warn',
        message: 'You have 2 unresolved compliance issues.',
        metadata: {},
        created_at: '2026-05-23T20:00:00Z',
      },
    ]);
    mockSafeFetch.mockResolvedValue(
      new Response(JSON.stringify({ advisory: 'Goal criterion 3/5 missing.', decision: 'allow' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const calls = await postDispatch({ event: 'stop', story_id: 'story-1' });
    expect(calls.code).toBe(200);
    const body = calls.body as { additionalContext: string };
    expect(body.additionalContext).toContain('compliance_engine');
    expect(body.additionalContext).toContain('You have 2 unresolved');
    expect(body.additionalContext).toContain('Goal criterion 3/5 missing.');
  });

  it('forwards decision != allow ONLY from goal_evaluator playbook', async () => {
    mockRpcService.mockResolvedValueOnce(true); // is_story_participant -> owner
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      playbook: 'goal_evaluator',
      priority: 1,
      event_logged: true,
    });
    mockRpcService.mockResolvedValueOnce([]);
    mockSafeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ advisory: '', decision: 'block', reason: 'Criterion 4/5 unmet' }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    const calls = await postDispatch({ event: 'stop', story_id: 'story-1' });
    expect(calls.body).toMatchObject({ decision: 'block', reason: 'Criterion 4/5 unmet' });
  });

  it('STRIPS decision != allow from non-goal_evaluator playbooks (advisory only)', async () => {
    mockRpcService.mockResolvedValueOnce(true); // is_story_participant -> owner
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      playbook: 'intent_advisor', // NOT goal_evaluator
      priority: 5,
      event_logged: true,
    });
    mockRpcService.mockResolvedValueOnce([]);
    mockSafeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ advisory: 'hint', decision: 'block', reason: 'should be stripped' }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    const calls = await postDispatch({ event: 'prompt_submit', story_id: 'story-1' });
    expect(calls.body).not.toMatchObject({ decision: 'block' });
    expect(calls.body).not.toMatchObject({ reason: expect.anything() });
  });

  it('n8n fetch failure → still returns drained nudges only', async () => {
    mockRpcService.mockResolvedValueOnce(true); // is_story_participant -> owner
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      playbook: 'compliance_enforcement',
      priority: 5,
      event_logged: true,
    });
    mockRpcService.mockResolvedValueOnce([
      {
        id: 'n1',
        event_origin: 'wf_dirigent_agent',
        severity: 'info',
        message: 'Lingering nudge.',
        metadata: {},
        created_at: '2026-05-23T20:00:00Z',
      },
    ]);
    mockSafeFetch.mockRejectedValue(new Error('connection refused'));

    const calls = await postDispatch({ event: 'post_tool', story_id: 'story-1' });
    expect(calls.code).toBe(200);
    const body = calls.body as { additionalContext: string };
    expect(body.additionalContext).toContain('Lingering nudge.');
  });

  it('dispatch RPC failure with story_id → still drains nudges', async () => {
    mockRpcService.mockResolvedValueOnce(true); // is_story_participant -> owner
    mockRpcService.mockRejectedValueOnce(new Error('dispatch RPC blew up'));
    mockRpcService.mockResolvedValueOnce([
      {
        id: 'n1',
        event_origin: 'scheduled',
        severity: 'info',
        message: 'Survived dispatch failure.',
        metadata: {},
        created_at: '2026-05-23T20:00:00Z',
      },
    ]);

    const calls = await postDispatch({ event: 'session_start', story_id: 'story-1' });
    expect(calls.code).toBe(200);
    const body = calls.body as { additionalContext?: string };
    expect(body.additionalContext).toContain('Survived dispatch failure.');
  });

  it('audit RPC fire-and-forget — failure does NOT block reply', async () => {
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      playbook: 'briefing',
      priority: 1,
      event_logged: true,
    });
    mockRpcService.mockResolvedValueOnce([]);
    mockSafeFetch.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    mockRpcService.mockRejectedValueOnce(new Error('audit DB down'));

    const calls = await postDispatch({ event: 'session_start' });
    expect(calls.code).toBe(200); // reply succeeded despite audit failure
  });
});

describe('POST /dirigent/dispatch :: edge cases (gap-fill)', () => {
  beforeEach(() => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-uuid-trusted' });
  });

  it('story_id: null → drain RPC skipped (no story = no nudges to drain)', async () => {
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      playbook: 'briefing',
      priority: 1,
      event_logged: true,
    });
    mockSafeFetch.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    await postDispatch({ event: 'session_start', story_id: null });

    const drainCalls = mockRpcService.mock.calls.filter(
      ([fn]) => fn === 'dirigent_drain_nudges',
    );
    // drainNudges() short-circuits on null storyId without calling the RPC
    expect(drainCalls).toHaveLength(0);
  });

  it('story_id: empty string → drain RPC still skipped (falsy guard)', async () => {
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      playbook: 'briefing',
      priority: 1,
      event_logged: true,
    });
    mockSafeFetch.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    await postDispatch({ event: 'session_start', story_id: '' });

    const drainCalls = mockRpcService.mock.calls.filter(
      ([fn]) => fn === 'dirigent_drain_nudges',
    );
    expect(drainCalls).toHaveLength(0);
  });

  it('dispatch RPC returns object WITHOUT playbook field → degrades gracefully (200 with empty/nudges-only body)', async () => {
    mockRpcService.mockResolvedValueOnce(true); // is_story_participant -> owner
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-1',
      priority: 1,
      event_logged: true,
      // playbook MISSING — older RPC version or unknown event mapping
    });
    const calls = await postDispatch({ event: 'session_start', story_id: 'story-1' });
    expect(calls.code).toBe(200);
    // No n8n call when no playbook resolved
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('audit log payload structure: event/playbook/session_id/nudges_drained/story_id', async () => {
    mockRpcService.mockResolvedValueOnce(true); // is_story_participant -> owner
    mockRpcService.mockResolvedValueOnce({
      session_id: 'sess-x',
      playbook: 'briefing',
      priority: 1,
      event_logged: true,
    });
    mockRpcService.mockResolvedValueOnce([
      {
        id: 'n1', event_origin: 'wf_dirigent_agent', severity: 'info',
        message: 'x', metadata: {}, created_at: '2026-05-23T20:00:00Z',
      },
    ]);
    mockSafeFetch.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    mockRpcService.mockResolvedValueOnce(null); // audit RPC

    await postDispatch({ event: 'session_start', story_id: 'story-9' });

    const auditCall = mockRpcService.mock.calls.find(
      ([fn]) => fn === 'log_integration_action',
    );
    expect(auditCall, 'log_integration_action MUST be called').toBeDefined();
    const auditParams = auditCall![1] as { p_payload: Record<string, unknown> };
    expect(auditParams.p_payload).toMatchObject({
      event: 'session_start',
      playbook: 'briefing',
      session_id: 'sess-x',
      nudges_drained: 1,
      story_id: 'story-9',
    });
    // p_payload must NOT contain user-supplied tool_input (PII leak risk)
    expect(auditParams.p_payload).not.toHaveProperty('tool_input');
  });
});

/**
 * Component 4 E12 — behavioral test of the live monitoring loop
 * (relay payload → POST /dirigent/dispatch → agent_live_sessions).
 *
 * This is the executor→monitor half of the round-trip: when the relay attaches
 * a `live_session` block, the route must upsert agent_live_sessions (which lazily
 * owns the per-session ide_session ai_run that the cost rollup + the watchdog read)
 * and, for tool events, log a tool_use trace event — without ever blocking the
 * dispatch reply. The agent_run_id propagation is what lets an AISHA-SPAWNED
 * Claude run (Component 4) show up as `AISHA` in Mission Control.
 */
describe('POST /dirigent/dispatch :: E12 live session monitoring loop', () => {
  // dispatch by RPC name (the live-session upsert is fire-and-forget and
  // interleaves with the main dispatch path — order-based mocking is racy).
  function rpcByName(map: Record<string, unknown>) {
    mockRpcService.mockImplementation(((fn: string) =>
      Promise.resolve(fn in map ? map[fn] : null)) as never);
  }
  // flush the `void writeLiveSession(...)` fire-and-forget (two sequential awaits).
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    mockVerifyToken.mockResolvedValue({ userId: 'jwt-user' });
  });

  it('upserts agent_live_sessions propagating relay agent_run_id, but user_id from JWT (not relay body)', async () => {
    mockRpcService.mockResolvedValueOnce(true); // is_story_participant -> owner
    rpcByName({ dirigent_dispatch_event: null });
    await postDispatch({
      event: 'pre_tool',
      session_id: 'sess-42',
      story_id: 'story-7',
      live_session: {
        source: 'aisha-claude',
        agent_run_id: 'run-abc',     // E2/E4 link: AISHA-spawned run
        user_id: 'attacker-injected', // MUST be ignored (route never reads ls.user_id)
        branch: 'feat/x',
        phase: 'tool_use',
        tool_name: 'Edit',
        file_path: 'src/foo.ts',
      },
    });
    await flush();
    const call = mockRpcService.mock.calls.find(
      ([fn]) => fn === 'fn_upsert_agent_live_session',
    );
    expect(call, 'live_session must trigger the upsert RPC').toBeDefined();
    const p = call![1] as Record<string, unknown>;
    expect(p.p_agent_run_id).toBe('run-abc');   // spawned-run monitoring link
    expect(p.p_user_id).toBe('jwt-user');        // trusted JWT sub
    expect(p.p_user_id).not.toBe('attacker-injected');
    expect(p.p_session_id).toBe('sess-42');
    expect(p.p_source).toBe('aisha-claude');
    expect(p.p_phase).toBe('tool_use');
    expect(p.p_story_id).toBe('story-7');
  });

  it('stop event with no explicit phase defaults the session to stopped', async () => {
    rpcByName({ dirigent_dispatch_event: null });
    await postDispatch({
      event: 'stop',
      session_id: 'sess-1',
      live_session: { source: 'claude-code' },
    });
    await flush();
    const p = mockRpcService.mock.calls.find(
      ([fn]) => fn === 'fn_upsert_agent_live_session',
    )![1] as Record<string, unknown>;
    expect(p.p_phase).toBe('stopped');
  });

  it('tool events also log a tool_use trace event; lifecycle events do not', async () => {
    // pre_tool → trace event logged (feeds ai_trace_events → cost rollup → watchdog)
    rpcByName({ dirigent_dispatch_event: null });
    await postDispatch({
      event: 'post_tool',
      session_id: 's1',
      live_session: { source: 'claude-code', tool_name: 'Bash' },
    });
    await flush();
    expect(
      mockRpcService.mock.calls.some(([fn]) => fn === 'fn_log_agent_session_event'),
    ).toBe(true);

    // session_start → NO trace event (lifecycle captured by the ai_run row itself)
    mockRpcService.mockReset();
    rpcByName({ dirigent_dispatch_event: null });
    await postDispatch({
      event: 'session_start',
      session_id: 's2',
      live_session: { source: 'claude-code' },
    });
    await flush();
    expect(
      mockRpcService.mock.calls.some(([fn]) => fn === 'fn_log_agent_session_event'),
    ).toBe(false);
  });

  it('no live_session block → monitoring upsert is NOT called (opt-in by the relay)', async () => {
    rpcByName({ dirigent_dispatch_event: null });
    await postDispatch({ event: 'pre_tool', session_id: 's3' }); // no live_session
    await flush();
    expect(
      mockRpcService.mock.calls.some(([fn]) => fn === 'fn_upsert_agent_live_session'),
    ).toBe(false);
  });

  it('a failing live-session upsert is fire-and-forget — dispatch still returns 200', async () => {
    mockRpcService.mockImplementation(((fn: string) =>
      fn === 'fn_upsert_agent_live_session'
        ? Promise.reject(new Error('live upsert DB down'))
        : Promise.resolve(null)) as never);
    const calls = await postDispatch({
      event: 'pre_tool',
      session_id: 's4',
      live_session: { source: 'claude-code' },
    });
    await flush();
    expect(calls.code).toBe(200); // monitoring failure never blocks the agent
  });
});

describe('POST /dirigent/dispatch :: story ownership (cross-tenant isolation)', () => {
  beforeEach(() => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-uuid-owner' });
  });

  it('403 when body.story_id belongs to another tenant (is_story_participant=false)', async () => {
    mockRpcService.mockResolvedValueOnce(false); // NOT a participant
    const calls = await postDispatch({ event: 'stop', story_id: 'foreign-story' });
    expect(calls.code).toBe(403);
    expect(calls.body).toMatchObject({ error: 'story_forbidden' });
    const owned = mockRpcService.mock.calls.filter(([fn]) => fn === 'is_story_participant');
    expect(owned).toHaveLength(1);
    expect(owned[0][1]).toEqual({ p_user_id: 'user-uuid-owner', p_story_id: 'foreign-story' });
    // the foreign story_id must NOT reach any service-role RPC
    expect(mockRpcService.mock.calls.some(([fn]) => fn === 'dirigent_dispatch_event')).toBe(false);
    expect(mockRpcService.mock.calls.some(([fn]) => fn === 'dirigent_drain_nudges')).toBe(false);
  });

  it('fails closed (drops story_id, no 403) when the ownership check errors', async () => {
    mockRpcService.mockImplementation(async (fn: string) => {
      if (fn === 'is_story_participant') throw new Error('db down');
      return null; // dispatch → no playbook
    });
    const calls = await postDispatch({ event: 'stop', story_id: 'foreign-story' });
    expect(calls.code).toBe(200); // supervision degrades, never blocks
    const drain = mockRpcService.mock.calls.find(([fn]) => fn === 'dirigent_drain_nudges');
    if (drain) expect(drain[1].p_story_id).toBeNull(); // unverified story never drained
  });

  it('proceeds when the user owns the story', async () => {
    mockRpcService.mockResolvedValueOnce(true); // owner
    mockRpcService.mockResolvedValueOnce(null); // dispatch → degrade
    const calls = await postDispatch({ event: 'stop', story_id: 'my-story' });
    expect(calls.code).toBe(200);
    const owned = mockRpcService.mock.calls.find(([fn]) => fn === 'is_story_participant');
    expect(owned![1]).toEqual({ p_user_id: 'user-uuid-owner', p_story_id: 'my-story' });
  });
});
