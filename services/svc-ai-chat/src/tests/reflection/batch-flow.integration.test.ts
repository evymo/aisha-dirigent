/**
 * Batch dispatch — end-to-end orchestrator FLOW integration test.
 *
 * Unlike generator-batch-dispatch.unit.test.ts which only exercises the
 * generator handler in isolation, this test runs the FULL orchestrator
 * loop (runWorkflow → loads graph → executes nodes → handles suspensions)
 * with real generator + real orchestrator. Only the I/O boundary
 * (postgrest, checkpoint storage, llm provider HTTP, batch submit HTTP)
 * is stubbed via vi.mock.
 *
 * What this proves:
 *   1. AISHA decision (state.clow_backend.strategy='batch') survives all the
 *      orchestrator plumbing — loading run, executing generator, handling
 *      return value, calling saveCheckpoint with the right status.
 *   2. The 'waiting_batch' run status path mirrors 'waiting_human' (interrupt)
 *      — orchestrator returns EARLY with status set, NEVER falls through to
 *      the 'completed' saveCheckpoint at end of loop.
 *   3. State persistence: batch_job_id + external_batch_id + batch_provider
 *      land in checkpoint.state so a future WF_BATCH_RESUMER can find them.
 *   4. Sync path (strategy='sync') is unchanged — orchestrator runs to
 *      completion + saves 'completed'.
 *
 * @module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── In-memory test state ─────────────────────────────────────────────────────
// Mocked checkpoint store. Captures every saveCheckpoint(status?) call so we
// can assert the status timeline (running → waiting_batch  vs  running → completed).
const checkpointCalls: Array<{
  status: string | undefined;
  state: Record<string, unknown>;
}> = [];

let mockRunRecord: Record<string, unknown> = {};
let mockWorkflowGraph: Record<string, unknown> = {};

// ── postgrest mock ───────────────────────────────────────────────────────────
const rpcMock = vi.hoisted(() => vi.fn());
const insertRowMock = vi.hoisted(() => vi.fn());
const updateRowMock = vi.hoisted(() => vi.fn());

vi.mock('../../reflection/postgrest.js', () => ({
  rpc: rpcMock,
  insertRow: insertRowMock,
  updateRow: updateRowMock,
}));

// ── checkpointer mock — uses in-memory store ────────────────────────────────
const saveCheckpointMock = vi.hoisted(() => vi.fn());
const appendCostMock = vi.hoisted(() => vi.fn());
const loadRunMock = vi.hoisted(() => vi.fn());

vi.mock('../../reflection/checkpointer.js', () => ({
  saveCheckpoint: saveCheckpointMock,
  appendCost: appendCostMock,
  loadRun: loadRunMock,
}));

// ── contextLoader mock ───────────────────────────────────────────────────────
const loadContextMock = vi.hoisted(() => vi.fn());
vi.mock('../../reflection/contextLoader.js', () => ({
  loadContext: loadContextMock,
}));

// ── llmRouter mock ───────────────────────────────────────────────────────────
const unifiedChatMock = vi.hoisted(() => vi.fn());
const resolveProviderMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/llmRouter.js', () => ({
  unifiedChat: unifiedChatMock,
  resolveProvider: resolveProviderMock,
}));

// ── batchSubmitter mock ──────────────────────────────────────────────────────
const submitBatchMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/batchSubmitter.js', () => ({
  submitBatch: submitBatchMock,
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

// ── @aisha/security mock ─────────────────────────────────────────────────────
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

// ── fetch mock (used by orchestrator's fetchWorkflow + provider calls) ──────
const fetchMock = vi.hoisted(() => vi.fn());

let oldAllowUnpersistedDecisionJournal: string | undefined;

beforeEach(() => {
  oldAllowUnpersistedDecisionJournal =
    process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
  process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED = '1';

  // Reset call records
  rpcMock.mockReset();
  insertRowMock.mockReset();
  updateRowMock.mockReset();
  saveCheckpointMock.mockReset();
  appendCostMock.mockReset();
  loadRunMock.mockReset();
  loadContextMock.mockReset();
  unifiedChatMock.mockReset();
  resolveProviderMock.mockReset();
  submitBatchMock.mockReset();
  resolveSlotModelMock.mockReset();
  optimizePayloadMock.mockReset();
  fetchMock.mockReset();
  checkpointCalls.length = 0;

  // Default saveCheckpoint behavior: capture status + state in checkpointCalls.
  // Also keeps mockRunRecord.metadata.checkpoint in sync so subsequent loadRun
  // returns up-to-date state.
  saveCheckpointMock.mockImplementation(
    async (_runId: string, checkpoint: Record<string, unknown>, status?: string) => {
      checkpointCalls.push({
        status,
        state: { ...((checkpoint.state as Record<string, unknown>) ?? {}) },
      });
      // Persist into mockRunRecord so getCurrentRun(runId) sees latest state
      mockRunRecord = {
        ...mockRunRecord,
        status: status ?? (mockRunRecord.status as string) ?? 'running',
        metadata: {
          ...((mockRunRecord.metadata as Record<string, unknown>) ?? {}),
          checkpoint: { ...checkpoint },
        },
      };
    },
  );

  // loadRun returns the in-memory record
  loadRunMock.mockImplementation(async () => mockRunRecord);

  // loadContext returns empty bundle
  loadContextMock.mockResolvedValue({ profile: 'budget', tokenBudget: 1000, tokensUsed: 0, layers: {} });

  // soulforge defaults
  resolveSlotModelMock.mockReturnValue('claude-sonnet-4');
  resolveProviderMock.mockReturnValue('anthropic');
  optimizePayloadMock.mockImplementation(
    (raw: { system: string; user: string }) => ({
      system: raw.system,
      user: raw.user,
      reduction_pct: 0,
      dropped_segments: [],
    }),
  );

  // unifiedChat default (sync path)
  unifiedChatMock.mockResolvedValue({
    text: 'sync answer from llm',
    model: 'claude-sonnet-4',
    provider: 'anthropic',
    usage: { inputTokens: 10, outputTokens: 20 },
  });

  // insertRow / updateRow no-op (these write to ai_workflow_node_runs)
  insertRowMock.mockResolvedValue({ id: 'node-run-1', started_at: new Date().toISOString() });
  updateRowMock.mockResolvedValue(undefined);

  // fetch — used by fetchWorkflow + provider HTTP calls. Default = workflow load.
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('ai_workflow_definitions')) {
      return new Response(JSON.stringify([mockWorkflowGraph]), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);

  // rpc — used for getNextNode (fn_get_next_graph_node). Single-node graph
  // returns terminal after first execution.
  rpcMock.mockImplementation(async (fn: string, params: Record<string, unknown>) => {
    if (fn === 'fn_get_next_graph_node') {
      // Initial call (lastNodeId=null) → entry node
      if (params.p_last_node_id === null) {
        return {
          next_node: { id: 'gen', type: 'generator', config: {} },
          is_entry: true,
        };
      }
      // After generator → terminal (no more nodes)
      return { is_terminal: true };
    }
    return null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();

  if (oldAllowUnpersistedDecisionJournal === undefined) {
    delete process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
  } else {
    process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED =
      oldAllowUnpersistedDecisionJournal;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

function makeBatchEligibleRun(strategy: 'batch' | 'sync'): void {
  mockRunRecord = {
    id: 'run-flow-1',
    kind: 'reflection',
    story_id: 'story-7',
    actor_user_id: null,
    status: 'running',
    workflow_definition_id: 'wf-1',
    metadata: {
      workflow_name: 'budget-batch-flow-test',
      workflow_version: 1,
      input: { description: 'deferred batch task with long deadline' },
      context: { profile: 'budget' },
      checkpoint: {
        current_node: null,
        iteration: 0,
        history: [],
        state: {
          // Pre-populated by what would normally be openclaw_resolve_clow node
          clow_backend: {
            backend_kind: 'direct_cloud',
            provider_slug: 'anthropic',
            model_id: 'claude-sonnet-4',
            strategy,
            supports_batch: true,
          },
        },
      },
    },
    cost_total_json: {},
  };

  mockWorkflowGraph = {
    id: 'wf-1',
    name: 'budget-batch-flow-test',
    display_name: 'Budget batch flow test',
    graph: {
      entry: 'gen',
      nodes: [{ id: 'gen', type: 'generator', config: {} }],
      edges: [],
    },
    context: 'reflection',
    is_active: true,
    version: 1,
    metadata: {},
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Flow tests
// ───────────────────────────────────────────────────────────────────────────

describe('end-to-end orchestrator flow — batch dispatch path', () => {
  it('strategy=batch → run suspends with status=waiting_batch and batch state persisted', async () => {
    makeBatchEligibleRun('batch');
    submitBatchMock.mockResolvedValueOnce({
      batch_job_id: 'job-uuid-aaa',
      external_batch_id: 'msgbatch_ext_xxx',
      provider: 'anthropic',
      request_count: 1,
    });

    const { runWorkflow } = await import('../../reflection/orchestrator.js');
    const result = await runWorkflow('run-flow-1');

    // submitBatch was the path taken; unifiedChat (sync) NOT called
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
    expect(unifiedChatMock).not.toHaveBeenCalled();

    // The submitBatch call carried the right context (related_run_id, story_id)
    const submitArgs = submitBatchMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(submitArgs.provider).toBe('anthropic');
    expect(submitArgs.relatedRunId).toBe('run-flow-1');
    expect(submitArgs.storyId).toBe('story-7');

    // ─── Orchestrator status timeline contract ─────────────────────────────
    // saveCheckpoint should have been called with status='waiting_batch'
    // AT LEAST once. Critically, it should NEVER have been called with
    // status='completed' (that would mean the run terminated normally
    // instead of suspending).
    const statuses = checkpointCalls.map((c) => c.status);
    expect(statuses).toContain('waiting_batch');
    expect(statuses).not.toContain('completed');

    // ─── State persistence contract ────────────────────────────────────────
    // Latest checkpoint state must include batch identifiers so a future
    // WF_BATCH_RESUMER can locate + resume this run.
    const lastSave = checkpointCalls[checkpointCalls.length - 1]!;
    expect(lastSave.state.batch_job_id).toBe('job-uuid-aaa');
    expect(lastSave.state.external_batch_id).toBe('msgbatch_ext_xxx');
    expect(lastSave.state.batch_provider).toBe('anthropic');

    // runWorkflow returns the up-to-date run record (status persisted)
    expect(result.status).toBe('waiting_batch');
  });

  it('strategy=batch + provider=openai → submitBatch called with OpenAI shape, run suspends', async () => {
    makeBatchEligibleRun('batch');
    // Override clow_backend to openai
    const meta = mockRunRecord.metadata as Record<string, unknown>;
    const cp = meta.checkpoint as Record<string, unknown>;
    const st = cp.state as Record<string, unknown>;
    st.clow_backend = {
      backend_kind: 'direct_cloud',
      provider_slug: 'openai',
      model_id: 'gpt-4o',
      strategy: 'batch',
    };

    submitBatchMock.mockResolvedValueOnce({
      batch_job_id: 'job-uuid-bbb',
      external_batch_id: 'batch_yyy',
      provider: 'openai',
      request_count: 1,
    });

    const { runWorkflow } = await import('../../reflection/orchestrator.js');
    const result = await runWorkflow('run-flow-1');

    expect(submitBatchMock).toHaveBeenCalledTimes(1);
    const submitArgs = submitBatchMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(submitArgs.provider).toBe('openai');

    expect(result.status).toBe('waiting_batch');
  });
});

describe('end-to-end orchestrator flow — sync dispatch path', () => {
  it('strategy=sync → run runs to completion with status=completed', async () => {
    makeBatchEligibleRun('sync');

    const { runWorkflow } = await import('../../reflection/orchestrator.js');
    const result = await runWorkflow('run-flow-1');

    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    expect(submitBatchMock).not.toHaveBeenCalled();

    // Status timeline: never sees waiting_batch, ends with completed
    const statuses = checkpointCalls.map((c) => c.status);
    expect(statuses).not.toContain('waiting_batch');
    expect(statuses).toContain('completed');

    expect(result.status).toBe('completed');
  });

  it('strategy=batch + submitBatch fails → soft-fall to sync, run completes', async () => {
    makeBatchEligibleRun('batch');
    submitBatchMock.mockRejectedValueOnce(new Error('Anthropic batch API 503'));

    const { runWorkflow } = await import('../../reflection/orchestrator.js');
    const result = await runWorkflow('run-flow-1');

    // submitBatch attempted, failed
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
    // unifiedChat ran as fallback
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);

    // Run did NOT suspend — it completed via sync path
    const statuses = checkpointCalls.map((c) => c.status);
    expect(statuses).not.toContain('waiting_batch');
    expect(statuses).toContain('completed');

    expect(result.status).toBe('completed');
  });
});

describe('end-to-end orchestrator flow — provider routing contract', () => {
  it('strategy=batch + provider_slug=llmgateway-io + backend_kind=llm_gateway → falls back to sync (gateway batch not wired yet)', async () => {
    makeBatchEligibleRun('batch');
    // llmgateway.io as provider — backend_kind='llm_gateway' currently
    // soft-falls to sync per generator.ts (gateway-side batch normalization
    // is a follow-up item in Phase 2D plan).
    const meta = mockRunRecord.metadata as Record<string, unknown>;
    const cp = meta.checkpoint as Record<string, unknown>;
    const st = cp.state as Record<string, unknown>;
    st.clow_backend = {
      backend_kind: 'llm_gateway',
      provider_slug: 'llmgateway-io',
      model_id: 'mistral-large',
      strategy: 'batch',
    };

    const { runWorkflow } = await import('../../reflection/orchestrator.js');
    const result = await runWorkflow('run-flow-1');

    // No batch submission attempted for gateway provider (Phase 2D limitation)
    expect(submitBatchMock).not.toHaveBeenCalled();
    // Falls through to sync unifiedChat with provider='gateway'
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    const chatArgs = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(chatArgs.provider).toBe('gateway');
    expect(chatArgs.model).toBe('mistral-large');

    expect(result.status).toBe('completed');
  });

  it('strategy=sync + provider_slug=llmgateway-io → routes via gateway LlmProvider', async () => {
    makeBatchEligibleRun('sync');
    const meta = mockRunRecord.metadata as Record<string, unknown>;
    const cp = meta.checkpoint as Record<string, unknown>;
    const st = cp.state as Record<string, unknown>;
    st.clow_backend = {
      backend_kind: 'llm_gateway',
      provider_slug: 'llmgateway-io',
      model_id: 'grok-2',
      strategy: 'sync',
    };

    const { runWorkflow } = await import('../../reflection/orchestrator.js');
    const result = await runWorkflow('run-flow-1');

    // The flow proves AISHA can route any model through llmgateway-io
    // (pooled access to xAI/Mistral/DeepSeek etc.) — provider='gateway'
    // in unifiedChat means hitting createGatewayBackend (which uses
    // AISHA_LLM_GATEWAY_URL + AISHA_LLM_GATEWAY_KEY).
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    const chatArgs = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(chatArgs.provider).toBe('gateway');
    expect(chatArgs.model).toBe('grok-2');

    expect(result.status).toBe('completed');
  });
});
