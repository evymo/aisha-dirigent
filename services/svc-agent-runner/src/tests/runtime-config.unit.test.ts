/**
 * Dynamic runner caps resolver — proves the resolution order
 * system_config (DB) → env (config.ts) → fail-safe, plus caching + error safety.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpcService } = vi.hoisted(() => ({ mockRpcService: vi.fn() }));
vi.mock('../db.js', () => ({ rpcService: mockRpcService }));
// The env/default LAYER (config.ts already reads process.env with safe defaults).
vi.mock('../config.js', () => ({
  config: {
    claudePollEnabled: false,
    maxConcurrentClaudeRuns: 3,
    claudePollIntervalMs: 5_000,
    claudePollGraceSeconds: 10,
    execMemoryLimit: '1g',
    claudeCliTimeoutMs: 3_600_000,
  },
}));

beforeEach(async () => {
  mockRpcService.mockReset();
  const { __resetRunnerCapsCache } = await import('../runtime-config.js');
  __resetRunnerCapsCache();
});

describe('getRunnerCaps — dynamic resolution', () => {
  it('DB system_config values WIN over the env layer', async () => {
    mockRpcService.mockResolvedValue({
      poll_enabled: true, max_concurrent: 8, poll_interval_ms: 2000,
      poll_grace_seconds: 3, exec_memory_limit: '2g', cli_timeout_ms: 900000,
    });
    const { getRunnerCaps } = await import('../runtime-config.js');
    const caps = await getRunnerCaps(0);
    expect(caps).toEqual({
      pollEnabled: true, maxConcurrent: 8, pollIntervalMs: 2000,
      pollGraceSeconds: 3, execMemoryLimit: '2g', cliTimeoutMs: 900000,
    });
    // read from the platform's dynamic-config getter
    expect(mockRpcService).toHaveBeenCalledWith('get_system_config', { p_key: 'agent_runner' });
  });

  it('falls back to the env layer when the DB key is absent ({} )', async () => {
    mockRpcService.mockResolvedValue({}); // get_system_config returns {} for a missing key
    const { getRunnerCaps } = await import('../runtime-config.js');
    const caps = await getRunnerCaps(0);
    expect(caps.pollEnabled).toBe(false);      // config.claudePollEnabled
    expect(caps.maxConcurrent).toBe(3);        // config.maxConcurrentClaudeRuns
    expect(caps.execMemoryLimit).toBe('1g');   // config.execMemoryLimit
  });

  it('partial DB override merges with env for the rest', async () => {
    mockRpcService.mockResolvedValue({ max_concurrent: 12 }); // only the cap tuned
    const { getRunnerCaps } = await import('../runtime-config.js');
    const caps = await getRunnerCaps(0);
    expect(caps.maxConcurrent).toBe(12);       // from DB
    expect(caps.pollIntervalMs).toBe(5_000);   // from env
  });

  it('clamps unsafe values — 0/garbage cap becomes 1, never unlimited', async () => {
    mockRpcService.mockResolvedValue({ max_concurrent: 0 });
    const { getRunnerCaps } = await import('../runtime-config.js');
    expect((await getRunnerCaps(0)).maxConcurrent).toBe(1);
  });

  it('a DB error serves the env fail-safe, never loses caps', async () => {
    mockRpcService.mockRejectedValue(new Error('postgrest down'));
    const { getRunnerCaps } = await import('../runtime-config.js');
    const caps = await getRunnerCaps(0);
    expect(caps.maxConcurrent).toBe(3);   // env fail-safe
    expect(caps.pollEnabled).toBe(false);
  });

  it('caches within the TTL and refreshes after it', async () => {
    mockRpcService.mockResolvedValue({ max_concurrent: 5 });
    const { getRunnerCaps } = await import('../runtime-config.js');
    await getRunnerCaps(0);
    await getRunnerCaps(10_000); // within 30s TTL → cached, no new fetch
    expect(mockRpcService).toHaveBeenCalledTimes(1);
    await getRunnerCaps(40_000); // past TTL → refetch
    expect(mockRpcService).toHaveBeenCalledTimes(2);
  });
});
