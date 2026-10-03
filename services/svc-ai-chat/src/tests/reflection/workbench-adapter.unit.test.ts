/**
 * workbenchAdapter — the central side of the PR-J poll+block rail. enqueue → block-poll
 * → RuntimeResult; a 'failed' status or a timeout returns ok:false (never throws, so
 * runtime_dispatch transitions to 'failed' not a fatal adapter error). isAvailable is the
 * config flag only (sync). rpc + journalDispatch + config injected via vi.mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockJournal, cfg } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockJournal: vi.fn(),
  cfg: { enableWorkbench: true, workbenchPollTimeoutMs: 3000 },
}));

vi.mock('../../reflection/postgrest.js', () => ({ rpc: mockRpc }));
vi.mock('../../lib/dispatchJournal.js', () => ({ journalDispatch: mockJournal }));
vi.mock('../../reflection/config.js', () => ({ reflectionConfig: cfg }));

import { workbenchAdapter } from '../../reflection/runtime/workbench-adapter.js';

const work = {
  clow: { purpose: 'do x' },
  input: 'do x',
  model: { provider: 'ollama-local', model_id: 'llama3' },
} as never;

beforeEach(() => {
  mockRpc.mockReset();
  mockJournal.mockReset();
  mockJournal.mockResolvedValue('dec-1');
  cfg.enableWorkbench = true;
  cfg.workbenchPollTimeoutMs = 3000;
});

describe('workbenchAdapter', () => {
  it('runtime is "workbench" and isAvailable reflects the config flag (sync)', () => {
    expect(workbenchAdapter.runtime).toBe('workbench');
    expect(workbenchAdapter.isAvailable()).toBe(true);
    cfg.enableWorkbench = false;
    expect(workbenchAdapter.isAvailable()).toBe(false);
  });

  it('enqueue → poll → completed: ok result threads decision_id + carries model/provider', async () => {
    mockRpc.mockImplementation(async (fn: string) =>
      fn === 'enqueue_workbench_request' ? 'req-1' : { status: 'completed', output: 'hi', tokens_out: 5 },
    );
    const res = await workbenchAdapter.execute(work);
    expect(res).toMatchObject({ runtime: 'workbench', ok: true, output: 'hi' });
    expect(res.detail?.decision_id).toBe('dec-1');
    expect(res.tokensOut).toBe(5);
    const enq = mockRpc.mock.calls.find(([f]) => f === 'enqueue_workbench_request');
    expect(enq?.[1]).toMatchObject({ p_decision_id: 'dec-1', p_model_id: 'llama3', p_provider_slug: 'ollama-local' });
  });

  it('failed status → ok:false with the error detail', async () => {
    mockRpc.mockImplementation(async (fn: string) =>
      fn === 'enqueue_workbench_request' ? 'req-1' : { status: 'failed', error_detail: { message: 'boom' } },
    );
    const res = await workbenchAdapter.execute(work);
    expect(res.ok).toBe(false);
    expect(res.detail?.error_detail).toMatchObject({ message: 'boom' });
  });

  it('timeout (always pending) → ok:false, NEVER throws', async () => {
    cfg.workbenchPollTimeoutMs = 100;
    mockRpc.mockImplementation(async (fn: string) =>
      fn === 'enqueue_workbench_request' ? 'req-1' : { status: 'pending' },
    );
    const res = await workbenchAdapter.execute(work);
    expect(res.ok).toBe(false);
    expect(res.detail?.error).toBe('workbench_timeout');
  });

  it('an enqueue failure → ok:false (soft), never throws', async () => {
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'enqueue_workbench_request') throw new Error('pg down');
      return { status: 'pending' };
    });
    const res = await workbenchAdapter.execute(work);
    expect(res.ok).toBe(false);
    expect(res.detail?.error).toBe('workbench_enqueue_failed');
  });
});
