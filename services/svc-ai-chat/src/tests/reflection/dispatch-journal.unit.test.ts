/**
 * Unit tests for journalDispatch — the I1 backstop that journals model-override
 * dispatch sites (routes / critic / proactive) so no LLM call escapes the
 * ai_decisions journal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// recordExecutionDecision dynamically imports reflection/postgrest.js — mock the
// rpc so we can assert the journaled decision shape without a database.
const { mockRpc, safeWarn, safeError } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  safeWarn: vi.fn(),
  safeError: vi.fn(),
}));
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn, safeError, safeDebug: vi.fn() }),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));
vi.mock('../../reflection/postgrest.js', () => ({ rpc: mockRpc }));

import { journalDispatch } from '../../lib/dispatchJournal.js';

type RecordedCall = [
  fn: string,
  params: { p_run_id: string | null; p_story_id: string | null; p_decision: Record<string, unknown> },
];

describe('journalDispatch — I1 backstop journaling', () => {
  const oldAllowUnpersisted = process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;

  beforeEach(() => {
    mockRpc.mockReset();
    safeWarn.mockReset();
    safeError.mockReset();
    delete process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
  });

  afterEach(() => {
    if (oldAllowUnpersisted === undefined) delete process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
    else process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED = oldAllowUnpersisted;
  });

  it('mints a model_override / direct_llm decision and returns its id', async () => {
    mockRpc.mockResolvedValueOnce('decision-abc');
    const id = await journalDispatch({
      model: 'gpt-4o-mini',
      provider: 'openai',
      runId: 'run-1',
      storyId: 'story-1',
      reason: 'evaluate.message',
    });
    expect(id).toBe('decision-abc');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fn, params] = mockRpc.mock.calls[0] as RecordedCall;
    expect(fn).toBe('fn_record_execution_decision');
    expect(params.p_run_id).toBe('run-1');
    expect(params.p_story_id).toBe('story-1');
    expect(params.p_decision.resolution_source).toBe('model_override');
    expect(params.p_decision.runtime).toBe('direct_llm');
    expect(params.p_decision.model_id).toBe('gpt-4o-mini');
    expect(params.p_decision.reason).toBe('evaluate.message');
  });

  it('derives the provider from the model when not supplied', async () => {
    mockRpc.mockResolvedValueOnce('d');
    await journalDispatch({ model: 'claude-sonnet-4-20250514' });
    const [, params] = mockRpc.mock.calls[0] as RecordedCall;
    expect(params.p_decision.provider_slug).toBe('anthropic'); // claude prefix → anthropic
  });

  it('passes null run/story for stateless route calls', async () => {
    mockRpc.mockResolvedValueOnce('d');
    await journalDispatch({ model: 'gpt-4o-mini', provider: 'openai' });
    const [, params] = mockRpc.mock.calls[0] as RecordedCall;
    expect(params.p_run_id).toBeNull();
    expect(params.p_story_id).toBeNull();
  });

  it('fails closed when journaling RPC throws (dispatch must not continue unjournaled)', async () => {
    mockRpc.mockRejectedValueOnce(new Error('no db'));
    await expect(journalDispatch({ model: 'gpt-4o-mini', provider: 'openai' })).rejects.toThrow(
      /refusing dispatch without durable decision_id/,
    );
    expect(safeError).toHaveBeenCalledWith(
      expect.stringContaining('failed to persist execution decision'),
      expect.any(Error),
      expect.objectContaining({ runtime: 'direct_llm', model_id: 'gpt-4o-mini' }),
    );
  });

  it('allows an unpersisted client id only behind the explicit emergency override', async () => {
    process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED = '1';
    mockRpc.mockRejectedValueOnce(new Error('no db'));
    const id = await journalDispatch({ model: 'gpt-4o-mini', provider: 'openai' });
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(safeWarn).toHaveBeenCalledWith(
      expect.stringContaining('unpersisted decision id issued'),
      expect.objectContaining({ decision_id: id, model_id: 'gpt-4o-mini' }),
    );
  });
});
