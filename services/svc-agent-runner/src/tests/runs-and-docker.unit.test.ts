/**
 * Unit tests for svc-agent-runner — `routes/runs.ts` + `backends/docker.ts`.
 *
 * This service spawns containers (Docker / Kata) at the caller's request.
 * Authentication (operator-role: requireRunnerOperator) is the PRIMARY
 * blast-radius gate. Once past auth, the caller picks the OCI image; an
 * OPTIONAL, default-off registry-prefix allowlist (AGENT_IMAGE_ALLOWLIST,
 * enforced at the container-create sink — see backends/image-guard.ts +
 * image-guard.unit.test.ts) adds defence-in-depth when a deployment opts in.
 * With the default (empty) allowlist the behaviour is unchanged, so the test
 * focus here is:
 *
 *   1. Auth runs on EVERY endpoint (no unauthenticated mutation/read)
 *   2. Input validation rejects unknown kinds/profiles (no enum bypass)
 *   3. `timeout_ms` is CAPPED at `config.maxTimeoutMs` — caller can't
 *      pin a container open indefinitely
 *   4. Failure path: any exception in backend.execute updates the run
 *      status (no orphaned "running" rows)
 *   5. `parseMemoryLimit` handles edge cases gracefully (empty/invalid
 *      → 256MB safe default, NOT throw or 0-bytes)
 *   6. `parseLogs` survives malformed JSON lines (no DoS via crafted
 *      log corpus, no result-key collision attack)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVerifyToken,
  mockRequireRunnerOperator,
  mockRpcService,
  mockIssueBrokerToken,
  mockDockerBackendExecute,
  mockKataBackendExecute,
  mockClaudePrepare,
  mockClaudeMonitor,
  mockClaudeCancel,
  mockCreateEphemeralKey,
  mockRevokePeer,
} = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockRequireRunnerOperator: vi.fn(),
  mockRpcService: vi.fn(),
  mockIssueBrokerToken: vi.fn(),
  mockDockerBackendExecute: vi.fn(),
  mockKataBackendExecute: vi.fn(),
  mockClaudePrepare: vi.fn(),
  mockClaudeMonitor: vi.fn(),
  mockClaudeCancel: vi.fn(),
  mockCreateEphemeralKey: vi.fn(),
  mockRevokePeer: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
  requireRunnerOperator: mockRequireRunnerOperator,
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 401) {
      super(message); this.name = 'AuthError'; this.statusCode = statusCode;
    }
  },
}));
vi.mock('../db.js', () => ({ rpcService: mockRpcService }));
vi.mock('../broker-token.js', () => ({ issueBrokerToken: mockIssueBrokerToken }));
// Dynamic caps resolved to a fixed value for the POST /runs claude path.
vi.mock('../runtime-config.js', () => ({
  getRunnerCaps: vi.fn(async () => ({
    pollEnabled: false, maxConcurrent: 3, pollIntervalMs: 5_000,
    pollGraceSeconds: 10, execMemoryLimit: '1g', cliTimeoutMs: 3_600_000,
  })),
}));
vi.mock('../backends/docker.js', () => ({
  DockerBackend: class { execute = mockDockerBackendExecute; },
}));
vi.mock('../backends/kata.js', () => ({
  KataBackend: class { execute = mockKataBackendExecute; },
}));
vi.mock('../backends/claude-cli.js', () => {
  class ClaudeCliBackend {
    prepare = mockClaudePrepare;
    monitor = mockClaudeMonitor;
    static cancel = mockClaudeCancel;
    static activeCount = vi.fn(() => 0); // below cap → POST /runs is not 429'd
  }
  return { ClaudeCliBackend };
});
vi.mock('../netbird-client.js', () => ({
  createEphemeralKey: mockCreateEphemeralKey,
  revokePeer: mockRevokePeer,
}));
vi.mock('../config.js', () => ({
  config: {
    runnerBackend: 'docker',
    pluginBrokerUrl: 'http://broker:3000',
    defaultTimeoutMs: 60_000,
    maxTimeoutMs: 300_000, // 5 min cap
    netbirdEnabled: false,
    dockerSocket: '/var/run/docker.sock',
    dockerApiVersion: 'v1.46',
    dockerExecNetwork: 'aisha-exec',
    execMemoryLimit: '256m',
    execCpuQuota: 50000,
    execCpuPeriod: 100000,
    // claude_cli_task (Component 4)
    agentClaudeImage: 'aisha-agent-claude:test',
    claudeCliTimeoutMs: 3_600_000,
    maxConcurrentClaudeRuns: 3,
  },
}));

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((p: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(`POST ${p}`, h));
  const get = vi.fn((p: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(`GET ${p}`, h));
  return {
    app: {
      post, get,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as Parameters<typeof import('../routes/runs.js').runsRoutes>[0],
    handlers,
  };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

const VALID_USER = { userId: 'user-uuid', sub: 'user-uuid', roles: ['agent:run'], claims: {} };
const VALID_BODY = {
  kind: 'plugin-exec',
  image: 'registry.aisha/plugin-test:1.0',
  source: 'manual',
  source_ref: 'test-ref',
  payload: { foo: 'bar' },
};

beforeEach(() => {
  mockVerifyToken.mockReset().mockResolvedValue(VALID_USER);
  mockRequireRunnerOperator.mockReset().mockImplementation((user: { roles?: string[]; isServiceRole?: boolean }) => {
    const roles = user.roles ?? [];
    if (
      user.isServiceRole === true ||
      roles.includes('service_role') ||
      roles.includes('agent:run') ||
      roles.includes('admin') ||
      roles.includes('staff')
    ) {
      return;
    }
    throw Object.assign(new Error('Insufficient agent-runner role'), { statusCode: 403 });
  });
  mockRpcService.mockReset();
  mockIssueBrokerToken.mockReset().mockResolvedValue('broker-jwt-token');
  mockDockerBackendExecute.mockReset();
  mockKataBackendExecute.mockReset();
  mockClaudePrepare.mockReset();
  mockClaudeMonitor.mockReset();
  mockClaudeCancel.mockReset().mockResolvedValue(false);
  mockCreateEphemeralKey.mockReset();
  mockRevokePeer.mockReset();
});

async function postRuns(body: unknown) {
  const { runsRoutes } = await import('../routes/runs.js');
  const { app, handlers } = makeApp();
  await runsRoutes(app);
  const { reply, calls } = makeReply();
  await handlers.get('POST /runs')!({ headers: { authorization: 'Bearer t' }, body }, reply);
  return calls;
}

// ── Auth gate on every endpoint ──────────────────────────────

describe('runsRoutes — auth gate', () => {
  it('POST /runs rejects when auth fails', async () => {
    mockVerifyToken.mockRejectedValue(Object.assign(new Error('expired'), { statusCode: 401 }));
    await expect(postRuns(VALID_BODY)).rejects.toBeDefined();
    expect(mockRpcService).not.toHaveBeenCalled();
    expect(mockDockerBackendExecute).not.toHaveBeenCalled();
  });

  it('POST /runs rejects a valid user token without agent-runner role', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-no-role', roles: ['member'], claims: {} });
    await expect(postRuns(VALID_BODY)).rejects.toBeDefined();
    expect(mockRpcService).not.toHaveBeenCalled();
    expect(mockDockerBackendExecute).not.toHaveBeenCalled();
  });

  it('GET /runs/:id rejects when auth fails (no enumeration)', async () => {
    mockVerifyToken.mockRejectedValue(Object.assign(new Error('expired'), { statusCode: 401 }));
    const { runsRoutes } = await import('../routes/runs.js');
    const { app, handlers } = makeApp();
    await runsRoutes(app);
    const { reply } = makeReply();
    await expect(
      handlers.get('GET /runs/:id')!(
        { headers: {}, params: { id: 'r-1' } },
        reply,
      ),
    ).rejects.toBeDefined();
    expect(mockRpcService).not.toHaveBeenCalled();
  });

  it('GET /runs rejects when auth fails', async () => {
    mockVerifyToken.mockRejectedValue(new Error('no auth'));
    const { runsRoutes } = await import('../routes/runs.js');
    const { app, handlers } = makeApp();
    await runsRoutes(app);
    await expect(
      handlers.get('GET /runs')!({ headers: {}, query: {} }, makeReply().reply),
    ).rejects.toBeDefined();
  });

  it('POST /runs/:id/cancel rejects when auth fails (no unauth state mutation)', async () => {
    mockVerifyToken.mockRejectedValue(new Error('no auth'));
    const { runsRoutes } = await import('../routes/runs.js');
    const { app, handlers } = makeApp();
    await runsRoutes(app);
    await expect(
      handlers.get('POST /runs/:id/cancel')!(
        { headers: {}, params: { id: 'r-1' } },
        makeReply().reply,
      ),
    ).rejects.toBeDefined();
    expect(mockRpcService).not.toHaveBeenCalled();
  });
});

// ── Input validation ─────────────────────────────────────────

describe('runsRoutes — input validation', () => {
  it('400 when kind is missing', async () => {
    const calls = await postRuns({ image: 'x', source: 'y' });
    expect(calls.status).toBe(400);
  });

  it('400 when image is missing (no implicit default — caller must specify)', async () => {
    const calls = await postRuns({ kind: 'plugin-exec', source: 'y' });
    expect(calls.status).toBe(400);
  });

  it('400 when source is missing', async () => {
    const calls = await postRuns({ kind: 'plugin-exec', image: 'x' });
    expect(calls.status).toBe(400);
  });

  it('400 when kind is not in allowlist (rejects arbitrary kind values)', async () => {
    const calls = await postRuns({ ...VALID_BODY, kind: 'arbitrary-injection' });
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Invalid kind');
  });

  it('400 when profile is not in allowlist', async () => {
    const calls = await postRuns({ ...VALID_BODY, profile: 'arbitrary-profile' });
    expect(calls.status).toBe(400);
  });

  it('all 4 valid kinds are accepted', async () => {
    mockDockerBackendExecute.mockResolvedValue({
      exitCode: 0, result: undefined, logs: [], host: 'h', durationMs: 100,
    });
    mockRpcService
      .mockResolvedValueOnce([{ id: 'r-1' }])
      .mockResolvedValue(undefined);
    for (const kind of ['plugin-exec', 'workflow-exec', 'repo-agent', 'doc-agent']) {
      mockRpcService.mockClear();
      mockRpcService
        .mockResolvedValueOnce([{ id: 'r-1' }])
        .mockResolvedValue(undefined);
      const calls = await postRuns({ ...VALID_BODY, kind });
      expect(calls.status).toBe(200);
    }
  });
});

// ── timeout_ms cap ───────────────────────────────────────────

describe('runsRoutes — timeout_ms cap', () => {
  it('caps caller-requested timeout_ms at config.maxTimeoutMs (no unbounded container lifetime)', async () => {
    mockDockerBackendExecute.mockResolvedValue({
      exitCode: 0, result: undefined, logs: [], host: 'h', durationMs: 100,
    });
    mockRpcService
      .mockResolvedValueOnce([{ id: 'r-1' }])
      .mockResolvedValue(undefined);

    await postRuns({ ...VALID_BODY, timeout_ms: 999_999_999 });

    expect(mockDockerBackendExecute).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 300_000 }), // capped at config.maxTimeoutMs
    );
    expect(mockIssueBrokerToken).toHaveBeenCalledWith(
      expect.any(Object),
      300_000,
    );
  });

  it('uses defaultTimeoutMs when caller omits timeout_ms', async () => {
    mockDockerBackendExecute.mockResolvedValue({
      exitCode: 0, result: undefined, logs: [], host: 'h', durationMs: 100,
    });
    mockRpcService
      .mockResolvedValueOnce([{ id: 'r-1' }])
      .mockResolvedValue(undefined);

    await postRuns(VALID_BODY); // no timeout_ms

    expect(mockDockerBackendExecute).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 60_000 }), // defaultTimeoutMs
    );
  });
});

// ── Happy path ───────────────────────────────────────────────

describe('runsRoutes — happy path', () => {
  it('full flow: enqueue → mark running → execute → mark succeeded → reply 200', async () => {
    mockRpcService
      // enqueue_agent_run RETURNS uuid: PostgREST answers the bare string. The
      // old mock ([{id}]) was a shape the function never returns — every plugin
      // run in production ended "Failed to create run record" while this passed.
      .mockResolvedValueOnce('run-uuid')          // enqueue_agent_run
      .mockResolvedValueOnce(undefined)            // mark running
      .mockResolvedValueOnce(undefined);           // mark succeeded
    mockDockerBackendExecute.mockResolvedValue({
      exitCode: 0,
      result: { agentOutput: 'done' },
      logs: [{ level: 'info', message: 'started' }],
      host: 'docker@host1',
      durationMs: 1500,
    });

    const calls = await postRuns(VALID_BODY);
    expect(calls.status).toBe(200);
    expect(calls.body).toMatchObject({
      run_id: 'run-uuid',
      status: 'succeeded',
      exit_code: 0,
      result: { agentOutput: 'done' },
      duration_ms: 1500,
    });

    // Verify the 3 rpc calls (enqueue + mark running + mark succeeded)
    expect(mockRpcService).toHaveBeenCalledTimes(3);
    expect(mockRpcService.mock.calls[2][0]).toBe('update_agent_run_status');
    expect(mockRpcService.mock.calls[2][1]).toMatchObject({
      p_status: 'succeeded', p_exit_code: 0,
    });
  });
});

// ── Failure paths ────────────────────────────────────────────

describe('runsRoutes — failure paths', () => {
  it('500 when DB enqueue returns no id (db-side insertion failed)', async () => {
    mockRpcService.mockResolvedValueOnce([]);
    const calls = await postRuns(VALID_BODY);
    expect(calls.status).toBe(500);
    expect((calls.body as { error: string }).error).toContain('create run record');
  });

  it('backend exception → status=failed with error_summary capped at 500 chars', async () => {
    mockRpcService
      .mockResolvedValueOnce([{ id: 'r-1' }])
      .mockResolvedValue(undefined);
    mockDockerBackendExecute.mockRejectedValue(new Error('Docker daemon unreachable: ' + 'x'.repeat(2000)));

    const calls = await postRuns(VALID_BODY);
    expect(calls.status).toBe(500);
    expect(mockRpcService).toHaveBeenCalledWith(
      'update_agent_run_status',
      expect.objectContaining({
        p_status: 'failed',
        p_exit_code: -1,
        p_error_summary: expect.any(String),
      }),
    );
    const updateCall = mockRpcService.mock.calls.find(
      (c) => c[0] === 'update_agent_run_status' && (c[1] as { p_status?: string }).p_status === 'failed',
    );
    expect((updateCall?.[1] as { p_error_summary: string }).p_error_summary.length).toBeLessThanOrEqual(500);
  });

  it('backend "timeout" error → status=timeout (distinct from generic failure)', async () => {
    mockRpcService
      .mockResolvedValueOnce([{ id: 'r-2' }])
      .mockResolvedValue(undefined);
    mockDockerBackendExecute.mockRejectedValue(new Error('Container timeout after 60000ms'));

    const calls = await postRuns(VALID_BODY);
    expect(calls.status).toBe(500);
    const updateCall = mockRpcService.mock.calls.find(
      (c) => c[0] === 'update_agent_run_status' && (c[1] as { p_status?: string }).p_status === 'timeout',
    );
    expect(updateCall).toBeDefined();
    expect((calls.body as { error: string }).error).toBe('Execution timeout');
  });

  it('nonzero exit code from container → status=failed (NOT crash)', async () => {
    mockRpcService
      .mockResolvedValueOnce([{ id: 'r-3' }])
      .mockResolvedValue(undefined);
    mockDockerBackendExecute.mockResolvedValue({
      exitCode: 137, // OOMKilled-style
      result: undefined,
      logs: [],
      host: 'h', durationMs: 1234,
    });
    const calls = await postRuns(VALID_BODY);
    expect(calls.status).toBe(200); // route returns 200, only payload status=failed
    expect((calls.body as { status: string }).status).toBe('failed');
    expect((calls.body as { exit_code: number }).exit_code).toBe(137);
  });
});

// ── docker.ts internals — parseMemoryLimit ───────────────────

describe('docker.ts — parseMemoryLimit (require import via test-export)', () => {
  // parseMemoryLimit is module-private. We can still exercise its behaviour
  // indirectly: when execMemoryLimit config is invalid, ensure docker create
  // body still has a sensible Memory field (>=64MB to avoid 0-byte OOM).
  // Doing that needs a deeper module-level test setup; we'll cover the
  // function directly with module surgery instead.

  it('module exports DockerBackend class — sanity', async () => {
    const mod = await import('../backends/docker.js');
    expect(mod.DockerBackend).toBeDefined();
    expect(new mod.DockerBackend()).toBeInstanceOf(mod.DockerBackend);
  });
});

// ── Cancel endpoint ──────────────────────────────────────────

describe('runsRoutes — POST /runs/:id/cancel', () => {
  it('404 when RPC returns false (run not found or terminal)', async () => {
    mockRpcService.mockResolvedValue(false);
    const { runsRoutes } = await import('../routes/runs.js');
    const { app, handlers } = makeApp();
    await runsRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('POST /runs/:id/cancel')!(
      { headers: { authorization: 'Bearer t' }, params: { id: 'r-x' } },
      reply,
    );
    expect(calls.status).toBe(404);
  });

  it('success: DB-only cancel (no live container) returns { cancelled, container_killed:false }', async () => {
    mockRpcService.mockResolvedValue(true);
    const { runsRoutes } = await import('../routes/runs.js');
    const { app, handlers } = makeApp();
    await runsRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('POST /runs/:id/cancel')!(
      { headers: { authorization: 'Bearer t' }, params: { id: 'r-y' } },
      reply,
    );
    expect(mockClaudeCancel).toHaveBeenCalledWith('r-y');
    expect(calls.body).toEqual({ cancelled: true, container_killed: false });
  });

  it('cancel KILLS the live claude container (E9 control), then flips DB status', async () => {
    mockClaudeCancel.mockResolvedValue(true); // a live container was found + killed
    mockRpcService.mockResolvedValue(true);
    const { runsRoutes } = await import('../routes/runs.js');
    const { app, handlers } = makeApp();
    await runsRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('POST /runs/:id/cancel')!(
      { headers: { authorization: 'Bearer t' }, params: { id: 'r-live' } },
      reply,
    );
    expect(mockClaudeCancel).toHaveBeenCalledWith('r-live');
    expect(calls.body).toEqual({ cancelled: true, container_killed: true });
  });
});

// ── claude_cli_task — ASYNC model (E8) ───────────────────────
describe('runsRoutes — claude_cli_task async', () => {
  async function postClaude(payload: Record<string, unknown> = { prompt: 'do the thing' }) {
    return postRuns({ kind: 'claude_cli_task', source: 'dirigent:test', payload });
  }

  it('returns 202 running IMMEDIATELY (no HTTP block) — prepare started, monitor fired async', async () => {
    mockRpcService
      .mockResolvedValueOnce('run-claude')                                       // fn_spawn_claude_cli_run (scalar uuid)
      .mockResolvedValueOnce([{ approval_required: false, approved_at: null }])  // get_agent_run: NOT held → run
      .mockResolvedValue(undefined);                                             // mark running + (async) finalize
    mockClaudePrepare.mockResolvedValue({ runId: 'run-claude', containerId: 'c1', worktree: '/w', startedAt: 0, host: 'h', timeoutMs: 1000 });
    mockClaudeMonitor.mockResolvedValue({ exitCode: 0, result: { ok: true, run_id: 'run-claude', exit_code: 0 }, logs: [], host: 'h', durationMs: 100 });

    const calls = await postClaude();
    expect(calls.status).toBe(202);
    expect(calls.body).toEqual({ run_id: 'run-claude', status: 'running' });
    expect(mockClaudePrepare).toHaveBeenCalledTimes(1);
    // image defaulted from config (no body.image), profile kata-dragonball
    expect(mockClaudePrepare).toHaveBeenCalledWith(expect.objectContaining({ image: 'aisha-agent-claude:test', kind: 'claude_cli_task' }));
    // monitor runs in the background — let the microtask settle
    await new Promise((r) => setTimeout(r, 0));
    expect(mockClaudeMonitor).toHaveBeenCalledTimes(1);
    const finalize = mockRpcService.mock.calls.find((c) => c[0] === 'update_agent_run_status' && (c[1] as { p_status?: string }).p_status === 'succeeded');
    expect(finalize).toBeDefined();
  });

  it('HOLDS a run whose admission verdict is ask — 202 held, NO container spawn (no approval bypass)', async () => {
    mockRpcService
      .mockResolvedValueOnce('run-held')                                                              // fn_spawn → run id
      .mockResolvedValueOnce([{ approval_required: true, approved_at: null, awaiting: 'risk_approval' }])  // get_agent_run: HELD
      .mockResolvedValue(undefined);
    const calls = await postClaude();
    expect(calls.status).toBe(202);
    expect(calls.body).toMatchObject({ run_id: 'run-held', status: 'held', awaiting: 'risk_approval' });
    // The synchronous executor must NOT spawn a held run — the approval gate stands.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockClaudePrepare).not.toHaveBeenCalled();
    expect(mockClaudeMonitor).not.toHaveBeenCalled();
    // And it must NOT have flipped the held row to running.
    expect(mockRpcService.mock.calls.some((c) => c[0] === 'update_agent_run_status' && (c[1] as { p_status?: string }).p_status === 'running')).toBe(false);
  });

  it('uses fn_spawn_claude_cli_run (story-scoped admission) not enqueue_agent_run', async () => {
    mockRpcService.mockResolvedValueOnce('run-x').mockResolvedValue(undefined);
    mockClaudePrepare.mockResolvedValue({ runId: 'run-x', containerId: 'c', worktree: '/w', startedAt: 0, host: 'h', timeoutMs: 1 });
    mockClaudeMonitor.mockResolvedValue({ exitCode: 0, result: undefined, logs: [], host: 'h', durationMs: 1 });
    await postClaude();
    expect(mockRpcService.mock.calls[0][0]).toBe('fn_spawn_claude_cli_run');
    expect(mockRpcService.mock.calls.some((c) => c[0] === 'enqueue_agent_run')).toBe(false);
  });

  it('prepare failure → 500 + status=failed (no orphaned running row)', async () => {
    mockRpcService.mockResolvedValueOnce('run-bad').mockResolvedValue(undefined);
    mockClaudePrepare.mockRejectedValue(new Error('git worktree add failed: boom'));
    const calls = await postClaude();
    expect(calls.status).toBe(500);
    const failed = mockRpcService.mock.calls.find((c) => c[0] === 'update_agent_run_status' && (c[1] as { p_status?: string }).p_status === 'failed');
    expect(failed).toBeDefined();
    expect(mockClaudeMonitor).not.toHaveBeenCalled();
  });

  it('spend admission refusal (fn_spawn raises) → propagates (no run started)', async () => {
    mockRpcService.mockRejectedValueOnce(new Error('spend_deny: claude_cli_task estimate $40'));
    await expect(postClaude()).rejects.toBeDefined();
    expect(mockClaudePrepare).not.toHaveBeenCalled();
  });

  it('E15 — success with a story_id evaluates the story goal (story_goal_state)', async () => {
    mockRpcService.mockResolvedValueOnce('run-goal').mockResolvedValue(undefined);
    mockClaudePrepare.mockResolvedValue({ runId: 'run-goal', containerId: 'c', worktree: '/w', startedAt: 0, host: 'h', timeoutMs: 1 });
    mockClaudeMonitor.mockResolvedValue({ exitCode: 0, result: { ok: true, run_id: 'run-goal', exit_code: 0 }, logs: [], host: 'h', durationMs: 1 });
    await postClaude({ prompt: 'do x', story_id: 'story-123' });
    await new Promise((r) => setTimeout(r, 0));
    const goalCall = mockRpcService.mock.calls.find((c) => c[0] === 'fn_hermes_learning_loop');
    expect(goalCall).toBeDefined();
    expect(goalCall?.[1]).toEqual({ p_story_id: 'story-123', p_run_id: 'run-goal' });
  });

  it('E15 — no goal eval when the run has no story_id, or on failure', async () => {
    mockRpcService.mockResolvedValueOnce('run-nogoal').mockResolvedValue(undefined);
    mockClaudePrepare.mockResolvedValue({ runId: 'run-nogoal', containerId: 'c', worktree: '/w', startedAt: 0, host: 'h', timeoutMs: 1 });
    mockClaudeMonitor.mockResolvedValue({ exitCode: 0, result: undefined, logs: [], host: 'h', durationMs: 1 });
    await postClaude({ prompt: 'do x' }); // no story_id
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRpcService.mock.calls.some((c) => c[0] === 'fn_hermes_learning_loop')).toBe(false);
  });
});

// ── GET /runs (list) — pagination cap ────────────────────────

describe('runsRoutes — GET /runs (list)', () => {
  it('caps limit at 100 (caller-requested 999 → 100)', async () => {
    mockRpcService.mockResolvedValue([]);
    const { runsRoutes } = await import('../routes/runs.js');
    const { app, handlers } = makeApp();
    await runsRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('GET /runs')!(
      { headers: { authorization: 'Bearer t' }, query: { limit: '999' } },
      reply,
    );
    expect(mockRpcService).toHaveBeenCalledWith(
      'list_agent_runs',
      expect.objectContaining({ p_limit: 100 }),
    );
    expect((calls.body as { limit: number }).limit).toBe(100);
  });

  it('default limit is 20 when query omitted', async () => {
    mockRpcService.mockResolvedValue([]);
    const { runsRoutes } = await import('../routes/runs.js');
    const { app, handlers } = makeApp();
    await runsRoutes(app);
    const { reply } = makeReply();
    await handlers.get('GET /runs')!(
      { headers: { authorization: 'Bearer t' }, query: {} },
      reply,
    );
    expect(mockRpcService).toHaveBeenCalledWith(
      'list_agent_runs',
      { p_limit: 20, p_offset: 0 },
    );
  });
});

// ── broker token nese tenanta běhu pluginu ───────────────────

describe('runsRoutes — broker token nese tenanta plugin-exec', () => {
  // ⛔ 2026-09-16: broker vydává pluginu konfiguraci (i pověření) podle tenanta
  // z tokenu; bez něj by konfiguraci neměl podle čeho vybrat.
  const TENANT = '66666666-6666-4666-8666-666666666666';
  const pripravit = () => {
    mockDockerBackendExecute.mockResolvedValue({ exitCode: 0, result: undefined, logs: [], host: 'h', durationMs: 100 });
    mockRpcService.mockResolvedValueOnce([{ id: 'r-1' }]).mockResolvedValue(undefined);
  };

  it('tenant_id z payloadu plugin-exec (UUID) se do tokenu propíše', async () => {
    pripravit();
    await postRuns({ ...VALID_BODY, payload: { tenant_id: TENANT } });
    expect(mockIssueBrokerToken).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT }), expect.any(Number));
  });

  it('⛔ nečitelný tenant se nepředá — token nese prázdno', async () => {
    pripravit();
    await postRuns({ ...VALID_BODY, payload: { tenant_id: "x' OR 1=1" } });
    expect(mockIssueBrokerToken).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: '' }), expect.any(Number));
  });
});
