/**
 * The regression test for the runaway-container incident.
 *
 * The original poller.unit.test.ts calls pollOnce ONCE with a synchronously-
 * resolving monitor, so a container never lives across ticks — it can never
 * observe accumulation. This drives the REAL setInterval loop with an INFINITE
 * backlog and HELD monitors (containers that stay alive), and asserts the live
 * count never exceeds MAX_CONCURRENT_CLAUDE_RUNS. It fails on the pre-fix code
 * (one new container every 5s, unbounded) and passes only with the capacity gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRpcService, mockIssueBrokerToken, fake } = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockIssueBrokerToken: vi.fn(),
  // Stateful fake backend: prepare() = a container goes live; monitor() is HELD
  // (a real run that hasn't exited) until the test releases it.
  fake: { live: 0, peakLive: 0, prepareCalls: 0, resolvers: [] as Array<() => void> },
}));

vi.mock('../db.js', () => ({ rpcService: mockRpcService }));
vi.mock('../broker-token.js', () => ({ issueBrokerToken: mockIssueBrokerToken }));
vi.mock('../netbird-client.js', () => ({ createEphemeralKey: vi.fn(), revokePeer: vi.fn() }));
// Dynamic caps resolved to a fixed value — the cap (3) is what this test enforces.
vi.mock('../runtime-config.js', () => ({
  getRunnerCaps: vi.fn(async () => ({
    pollEnabled: true, maxConcurrent: 3, pollIntervalMs: 5_000,
    pollGraceSeconds: 10, execMemoryLimit: '512m', cliTimeoutMs: 1_000,
  })),
}));
vi.mock('../backends/claude-cli.js', () => {
  class ClaudeCliBackend {
    async prepare(input: { runId: string }) {
      fake.prepareCalls += 1;
      fake.live += 1;
      if (fake.live > fake.peakLive) fake.peakLive = fake.live;
      return { runId: input.runId, containerId: 'c' + fake.prepareCalls, worktree: '/w', startedAt: 0, host: 'h', timeoutMs: 1000 };
    }
    monitor() {
      // Held: a live container that hasn't exited. Resolving it decrements live.
      return new Promise((resolve) => {
        fake.resolvers.push(() => {
          fake.live -= 1;
          resolve({ exitCode: 0, result: undefined, logs: [], host: 'h', durationMs: 1 });
        });
      });
    }
    static cancel = vi.fn();
    static activeCount(): number {
      return fake.live;
    }
  }
  return { ClaudeCliBackend };
});
vi.mock('../config.js', () => ({
  config: {
    runnerBackend: 'docker',
    pluginBrokerUrl: 'http://broker:3000',
    agentClaudeImage: 'aisha-agent-claude:test',
    netbirdEnabled: false,
    claudeCliTimeoutMs: 1_000,
    claudePollGraceSeconds: 10,
    claudePollEnabled: true,
    claudePollIntervalMs: 5_000,
    maxConcurrentClaudeRuns: 3, // the cap under test
  },
}));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  fake.live = 0;
  fake.peakLive = 0;
  fake.prepareCalls = 0;
  fake.resolvers = [];
  mockIssueBrokerToken.mockReset().mockResolvedValue('broker-jwt');
  // claim always returns a fresh queued row → an INFINITE backlog to drain.
  let n = 0;
  mockRpcService.mockReset().mockImplementation((fn: string) =>
    fn === 'claim_queued_claude_run'
      ? Promise.resolve([{ id: 'r' + ++n, image: 'img', profile: 'kata-dragonball', source: 'ui', source_ref: null, inputs: { prompt: 'do' } }])
      : Promise.resolve(undefined),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('claude poller — concurrency cap (runaway regression)', () => {
  it('an infinite backlog never exceeds MAX_CONCURRENT_CLAUDE_RUNS live containers', async () => {
    vi.useFakeTimers();
    const { startClaudePoller, stopClaudePoller } = await import('../poller.js');
    startClaudePoller(log);

    // Advance ~20 poll ticks with every monitor HELD. Pre-fix this spawns ~20
    // containers (one per tick); with the cap it tops out at 3.
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(5_000);

    expect(fake.peakLive).toBeLessThanOrEqual(3);
    expect(fake.prepareCalls).toBeLessThanOrEqual(3);
    expect(fake.live).toBe(3); // saturated at the cap, not climbing
    stopClaudePoller();
  });

  it('releasing one slot lets exactly one more claim through — never above the cap', async () => {
    vi.useFakeTimers();
    const { startClaudePoller, stopClaudePoller } = await import('../poller.js');
    startClaudePoller(log);

    // Saturate to the cap.
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.live).toBe(3);
    const claimsAtCap = fake.prepareCalls;

    // Free one slot (a container exits) → live drops to 2.
    fake.resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0); // flush the monitor resolve + finalize
    expect(fake.live).toBe(2);

    // Next tick claims exactly one more → back to cap, never above.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.live).toBe(3);
    expect(fake.peakLive).toBe(3);
    expect(fake.prepareCalls).toBe(claimsAtCap + 1);
    stopClaudePoller();
  });
});
