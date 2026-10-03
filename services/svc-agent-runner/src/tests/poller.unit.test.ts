/**
 * Unit tests for the Claude CLI poller (producer→executor link). Mocks the
 * claim RPC + the async ClaudeCliBackend, so the claim→prepare→monitor→finalize
 * (+ story goal eval) behaviour is verified without a real Docker daemon.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRpcService,
  mockIssueBrokerToken,
  mockClaudePrepare,
  mockClaudeMonitor,
  mockCreateEphemeralKey,
  mockRevokePeer,
} = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockIssueBrokerToken: vi.fn(),
  mockClaudePrepare: vi.fn(),
  mockClaudeMonitor: vi.fn(),
  mockCreateEphemeralKey: vi.fn(),
  mockRevokePeer: vi.fn(),
}));

vi.mock('../db.js', () => ({ rpcService: mockRpcService }));
vi.mock('../broker-token.js', () => ({ issueBrokerToken: mockIssueBrokerToken }));
vi.mock('../backends/claude-cli.js', () => {
  class ClaudeCliBackend {
    prepare = mockClaudePrepare;
    monitor = mockClaudeMonitor;
    static cancel = vi.fn();
    static activeCount = vi.fn(() => 0); // below cap → claims proceed
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
    netbirdEnabled: false,
    claudeCliTimeoutMs: 1_000,
    claudePollGraceSeconds: 10,
    claudePollEnabled: true,
    claudePollIntervalMs: 5_000,
    maxConcurrentClaudeRuns: 3,
  },
}));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// Dynamically-resolved caps (system_config → env) are passed INTO pollOnce.
const CAPS = {
  pollEnabled: true,
  maxConcurrent: 3,
  pollIntervalMs: 5_000,
  pollGraceSeconds: 10,
  execMemoryLimit: '1g',
  cliTimeoutMs: 1_000,
};

beforeEach(() => {
  mockRpcService.mockReset();
  mockIssueBrokerToken.mockReset().mockResolvedValue('broker-jwt');
  mockClaudePrepare.mockReset();
  mockClaudeMonitor.mockReset();
  mockCreateEphemeralKey.mockReset();
  mockRevokePeer.mockReset();
});

describe('claude poller — pollOnce', () => {
  it('no queued run → returns false, nothing spawned', async () => {
    mockRpcService.mockResolvedValueOnce([]); // claim returns nothing
    const { pollOnce } = await import('../poller.js');
    expect(await pollOnce(log, CAPS)).toBe(false);
    expect(mockClaudePrepare).not.toHaveBeenCalled();
    // claim uses the atomic SKIP-LOCKED RPC with the grace window
    expect(mockRpcService).toHaveBeenCalledWith('claim_queued_claude_run', { p_grace_seconds: 10 });
  });

  it('claimed run → prepare + monitor + finalize succeeded + story goal eval', async () => {
    mockRpcService
      .mockResolvedValueOnce([{ id: 'r1', image: 'img', profile: 'kata-dragonball', source: 'ui', source_ref: 'aisha/s1', inputs: { prompt: 'do', story_id: 'story-1' } }])
      .mockResolvedValue(undefined);
    mockClaudePrepare.mockResolvedValue({ runId: 'r1', containerId: 'c', worktree: '/w', startedAt: 0, host: 'h', timeoutMs: 1000 });
    // A successful run emits a well-formed `__result` sentinel (result-format contract).
    mockClaudeMonitor.mockResolvedValue({ exitCode: 0, result: { ok: true, run_id: 'r1', exit_code: 0 }, logs: [], host: 'h', durationMs: 1 });

    const { pollOnce } = await import('../poller.js');
    expect(await pollOnce(log, CAPS)).toBe(true);
    expect(mockClaudePrepare).toHaveBeenCalledWith(expect.objectContaining({ runId: 'r1', kind: 'claude_cli_task', image: 'img', profile: 'kata-dragonball' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockClaudeMonitor).toHaveBeenCalledTimes(1);
    const okCall = mockRpcService.mock.calls.find((c) => c[0] === 'update_agent_run_status' && (c[1] as { p_status?: string }).p_status === 'succeeded');
    expect(okCall).toBeDefined();
    // The structured result is persisted to agent_runs.outputs (previously discarded).
    expect((okCall?.[1] as { p_outputs?: { result_valid?: boolean } }).p_outputs?.result_valid).toBe(true);
    expect(mockRpcService.mock.calls.some((c) => c[0] === 'fn_hermes_learning_loop' && (c[1] as { p_story_id?: string }).p_story_id === 'story-1')).toBe(true);
  });

  it('exit 0 but NO/invalid __result sentinel → failed (result-format contract) + outputs persisted, no learning loop', async () => {
    mockRpcService
      .mockResolvedValueOnce([{ id: 'r3', image: 'img', profile: 'docker', source: 'ui', source_ref: null, inputs: { prompt: 'x', story_id: 'story-3' } }])
      .mockResolvedValue(undefined);
    mockClaudePrepare.mockResolvedValue({ runId: 'r3', containerId: 'c', worktree: '/w', startedAt: 0, host: 'h', timeoutMs: 1000 });
    // Container exited 0 but emitted no machine-readable sentinel — "exited 0" is NOT success.
    mockClaudeMonitor.mockResolvedValue({ exitCode: 0, result: undefined, logs: [{ level: 'info', message: 'partial' }], host: 'h', durationMs: 1 });

    const { pollOnce } = await import('../poller.js');
    expect(await pollOnce(log, CAPS)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    const call = mockRpcService.mock.calls.find((c) => c[0] === 'update_agent_run_status' && (c[1] as { p_run_id?: string }).p_run_id === 'r3');
    expect((call?.[1] as { p_status?: string }).p_status).toBe('failed');
    expect((call?.[1] as { p_outputs?: { result_valid?: boolean } }).p_outputs?.result_valid).toBe(false);
    // A failed run must NOT trigger the hermes learning loop.
    expect(mockRpcService.mock.calls.some((c) => c[0] === 'fn_hermes_learning_loop' && (c[1] as { p_story_id?: string }).p_story_id === 'story-3')).toBe(false);
  });

  it('prepare failure → finalize failed (no orphan running, no monitor)', async () => {
    mockRpcService
      .mockResolvedValueOnce([{ id: 'r2', image: 'img', profile: 'docker', source: 'ui', source_ref: null, inputs: { prompt: 'x' } }])
      .mockResolvedValue(undefined);
    mockClaudePrepare.mockRejectedValue(new Error('git worktree add failed: boom'));

    const { pollOnce } = await import('../poller.js');
    expect(await pollOnce(log, CAPS)).toBe(true);
    expect(mockRpcService.mock.calls.some((c) => c[0] === 'update_agent_run_status' && (c[1] as { p_status?: string }).p_status === 'failed')).toBe(true);
    expect(mockClaudeMonitor).not.toHaveBeenCalled();
  });
});
