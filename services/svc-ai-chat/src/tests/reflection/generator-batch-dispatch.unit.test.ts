/**
 * Generator node — batch dispatch unit tests.
 *
 * Locks in the contract: when `state.clow_backend.strategy === 'batch'` AND
 * provider supports batch endpoints (Anthropic Message Batches / OpenAI
 * Batch API), the generator MUST call submitBatch (not unifiedChat) and
 * suspend the run with output.batch_suspend = true.
 *
 * This was a real gap before — the resolver could return strategy='batch'
 * but the generator ignored it and ran sync, eliminating the ~50% cost
 * savings the resolver intended.
 *
 * Scenarios:
 *   1. strategy='batch' + provider='anthropic' → submitBatch called, run suspends
 *   2. strategy='batch' + provider='openai' → submitBatch called, run suspends
 *   3. strategy='batch' + provider='gateway' → fall back to sync (gateway
 *      batch passthrough NOT yet implemented per Layer 2D plan)
 *   4. strategy='batch' + submitBatch throws → soft-fall to sync unifiedChat
 *   5. strategy='sync' (default) → sync unifiedChat, no batch attempt
 *
 * @module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── llmRouter mock ───────────────────────────────────────────────────────────
const unifiedChatMock = vi.hoisted(() => vi.fn());
const resolveProviderMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/llmRouter.js', () => ({
  unifiedChat: unifiedChatMock,
  resolveProvider: resolveProviderMock,
  resolveAvailableModel: (m: string) => ({ model: m, provider: resolveProviderMock(m) }),
}));

// ── batchSubmitter mock ──────────────────────────────────────────────────────
const submitBatchMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/batchSubmitter.js', () => ({
  submitBatch: submitBatchMock,
  // BatchSubmitError needs to be a real class for `throw new BatchSubmitError(...)`
  // patterns; we use a stub class with the same shape.
  BatchSubmitError: class BatchSubmitError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

// ── soulforge mock ───────────────────────────────────────────────────────────
const resolveSlotModelMock = vi.hoisted(() => vi.fn());
const optimizePayloadMock = vi.hoisted(() => vi.fn());

vi.mock('../../reflection/soulforge.js', () => ({
  resolveSlotModel: resolveSlotModelMock,
  optimizePayload: optimizePayloadMock,
}));

// ── @aisha/security mock (createSafeLogger) ─────────────────────────────────
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({
    safeWarn: vi.fn(),
    safeError: vi.fn(),
    safeInfo: vi.fn(),
  }),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

let oldAllowUnpersistedDecisionJournal: string | undefined;

// ── Fixtures ─────────────────────────────────────────────────────────────────
function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-batch-1',
    kind: 'reflection',
    story_id: 'story-7',
    actor_user_id: null,
    status: 'running',
    workflow_definition_id: 'wf-1',
    metadata: {
      workflow_name: 'deploy-reflect',
      workflow_version: 1,
      input: { description: 'long-deadline reflection task' },
      context: { profile: 'budget' },
      checkpoint: { current_node: null, iteration: 0, history: [], state: {} },
    },
    cost_total_json: {},
    ...overrides,
  };
}

function makeCtx(state: Record<string, unknown> = {}, run = makeRun()) {
  return {
    run,
    node: { id: 'gen-batch', type: 'generator', config: {} },
    state: {
      task: { description: 'long-deadline reflection task' },
      ...state,
    },
    iteration: 1,
  } as unknown as Parameters<
    typeof import('../../reflection/nodes/generator.js').generator
  >[0];
}

beforeEach(() => {
  oldAllowUnpersistedDecisionJournal =
    process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
  process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED = '1';

  unifiedChatMock.mockReset();
  resolveProviderMock.mockReset();
  resolveSlotModelMock.mockReset();
  optimizePayloadMock.mockReset();
  submitBatchMock.mockReset();

  unifiedChatMock.mockResolvedValue({
    text: 'sync answer',
    model: 'claude-sonnet-4',
    provider: 'anthropic',
    usage: { inputTokens: 12, outputTokens: 24 },
  });
  resolveSlotModelMock.mockReturnValue('claude-sonnet-4');
  resolveProviderMock.mockReturnValue('anthropic');
  optimizePayloadMock.mockImplementation(
    (raw: { system: string; user: string }, _slot: string, _profile: string) => ({
      system: raw.system,
      user: raw.user,
      reduction_pct: 12.5,
      dropped_segments: [],
    }),
  );
});

afterEach(() => {
  if (oldAllowUnpersistedDecisionJournal === undefined) {
    delete process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
  } else {
    process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED =
      oldAllowUnpersistedDecisionJournal;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Batch dispatch contract
// ───────────────────────────────────────────────────────────────────────────

describe('generator — batch dispatch contract', () => {
  it('strategy=batch + provider=anthropic → submitBatch called, run suspends', async () => {
    submitBatchMock.mockResolvedValueOnce({
      batch_job_id: '11111111-1111-1111-1111-111111111111',
      external_batch_id: 'msgbatch_abc',
      provider: 'anthropic',
      request_count: 1,
    });

    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'direct_cloud',
        provider_slug: 'anthropic',
        model_id: 'claude-sonnet-4',
        strategy: 'batch',
        supports_batch: true,
      },
    });

    const result = await generator(ctx);

    // submitBatch must have been called (NOT unifiedChat)
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
    expect(unifiedChatMock).not.toHaveBeenCalled();

    const call = submitBatchMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.provider).toBe('anthropic');
    expect(call.relatedRunId).toBe('run-batch-1');
    expect(call.storyId).toBe('story-7');
    expect((call.requests as Array<unknown>).length).toBe(1);

    // Run suspension contract — orchestrator reads these:
    expect(result.batch_suspend).toBe(true);
    expect(result.transition_key).toBe('batch_submitted');
    expect(result.state_patch?.batch_job_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.state_patch?.external_batch_id).toBe('msgbatch_abc');
    expect(result.state_patch?.batch_provider).toBe('anthropic');

    // Tokens deferred (final usage lands when batch completes)
    expect(result.tokens_input).toBe(0);
    expect(result.tokens_output).toBe(0);

    // output_data exposes the batch context for ai_workflow_node_runs visibility
    expect(result.output_data.batch_submitted).toBe(true);
    expect(result.output_data.resolution_source).toBe('clow_backend');
  });

  it('strategy=batch + provider=openai → submitBatch called with OpenAI message shape', async () => {
    resolveProviderMock.mockReturnValue('openai');
    submitBatchMock.mockResolvedValueOnce({
      batch_job_id: '22222222-2222-2222-2222-222222222222',
      external_batch_id: 'batch_xyz',
      provider: 'openai',
      request_count: 1,
    });

    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'direct_cloud',
        provider_slug: 'openai',
        model_id: 'gpt-4o',
        strategy: 'batch',
      },
    });

    const result = await generator(ctx);

    expect(submitBatchMock).toHaveBeenCalledTimes(1);
    const call = submitBatchMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.provider).toBe('openai');

    // OpenAI shape: messages array contains BOTH system + user roles
    // (Anthropic uses top-level `system` instead).
    const requests = call.requests as Array<{ request: Record<string, unknown> }>;
    const messages = requests[0]!.request.messages as Array<{ role: string }>;
    expect(messages.length).toBe(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');

    expect(result.batch_suspend).toBe(true);
  });

  it('strategy=batch + provider=gateway → falls back to sync (gateway batch not wired)', async () => {
    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'llm_gateway',
        provider_slug: 'llm-gateway',
        model_id: 'claude-sonnet-4',
        strategy: 'batch',
      },
    });

    const result = await generator(ctx);

    // Gateway batch passthrough NOT implemented yet → no submitBatch attempted
    expect(submitBatchMock).not.toHaveBeenCalled();
    // Falls through to sync unifiedChat
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);

    expect(result.batch_suspend).toBeUndefined();
    expect(result.transition_key).toBe('generated');
  });

  it('strategy=batch + submitBatch throws → soft-fall to sync (run does not fail)', async () => {
    submitBatchMock.mockRejectedValueOnce(new Error('Anthropic 503 service unavailable'));

    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'direct_cloud',
        provider_slug: 'anthropic',
        model_id: 'claude-sonnet-4',
        strategy: 'batch',
      },
    });

    const result = await generator(ctx);

    expect(submitBatchMock).toHaveBeenCalledTimes(1);
    expect(unifiedChatMock).toHaveBeenCalledTimes(1); // sync fallback ran

    expect(result.batch_suspend).toBeUndefined();
    expect(result.transition_key).toBe('generated');
    expect(result.output_data.batch_submitted).toBeUndefined();
  });

  it('strategy=sync (default) → no batch attempt, plain unifiedChat call', async () => {
    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'direct_cloud',
        provider_slug: 'anthropic',
        model_id: 'claude-sonnet-4',
        strategy: 'sync',
      },
    });

    const result = await generator(ctx);

    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    expect(result.transition_key).toBe('generated');
  });

  it('no clow_backend → no batch attempt (slot-based fallback path)', async () => {
    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({}); // no clow_backend in state

    const result = await generator(ctx);

    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    expect(result.transition_key).toBe('generated');
  });
});
