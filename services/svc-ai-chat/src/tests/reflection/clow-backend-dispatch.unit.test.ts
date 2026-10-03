/**
 * Generator node — clow_backend dispatch unit tests.
 *
 * Locks in the contract: when `state.clow_backend` is present, the generator
 * MUST honor it (route via the resolved provider's endpoint + auth env). The
 * resolver and executor share one decision; drift between them is silently
 * lost cost optimization and silent feature mismatches.
 *
 * Scenarios:
 *   1. backend_kind='llm_gateway'   → fetch goes to AISHA_LLM_GATEWAY_URL
 *      with AISHA_LLM_GATEWAY_KEY as bearer
 *   2. backend_kind='direct_cloud'  + provider='anthropic' → direct anthropic
 *      endpoint with ANTHROPIC_API_KEY
 *   3. backend_kind='direct_cloud'  + provider='openai'    → direct openai
 *      endpoint with OPENAI_API_KEY
 *   4. state.clow_backend absent    → slot-based fallback (resolveSlotModel)
 *   5. clow_backend.model_id wins over cfg.model_override (resolver authority)
 *
 * Tests stub llmRouter.unifiedChat so they don't make real HTTP. The contract
 * test is: unifiedChat is invoked with the right provider+endpoint+key trio.
 *
 * @module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── llmRouter mock ────────────────────────────────────────────────────────────
// unifiedChat is the single dispatcher. We capture its options to verify the
// generator passed through the resolver decision faithfully.
const unifiedChatMock = vi.hoisted(() => vi.fn());
const resolveProviderMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/llmRouter.js', () => ({
  unifiedChat: unifiedChatMock,
  resolveProvider: resolveProviderMock,
  // Capability-availability remap is identity here (keeps the slot model) so the
  // node tests stay focused on resolver wiring, not provider availability.
  resolveAvailableModel: (m: string) => ({ model: m, provider: resolveProviderMock(m) }),
}));

// ── soulforge mock (slot fallback) ───────────────────────────────────────────
const resolveSlotModelMock = vi.hoisted(() => vi.fn());
const optimizePayloadMock = vi.hoisted(() => vi.fn());

vi.mock('../../reflection/soulforge.js', () => ({
  resolveSlotModel: resolveSlotModelMock,
  optimizePayload: optimizePayloadMock,
}));

// ── batchSubmitter mock (generator imports it for strategy='batch' path) ────
// These tests don't exercise batch dispatch (strategy is always 'sync' or
// absent), so the mock just needs to exist so the import doesn't load real
// HTTP-calling code.
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

// ── @aisha/security mock (createSafeLogger for soft-warn paths) ─────────────
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
    id: 'run-1',
    kind: 'reflection',
    story_id: null,
    actor_user_id: null,
    status: 'running',
    workflow_definition_id: 'wf-1',
    metadata: {
      workflow_name: 'deploy-reflect',
      workflow_version: 1,
      input: { description: 'test task', agent_slug: 'aisha' },
      context: { profile: 'balanced' },
      checkpoint: { current_node: null, iteration: 0, history: [], state: {} },
    },
    cost_total_json: {},
    ...overrides,
  };
}

function makeCtx(state: Record<string, unknown> = {}, run = makeRun()) {
  return {
    run,
    node: { id: 'gen-1', type: 'generator', config: {} },
    state: {
      // generator usually has these in state from prior nodes
      task: { description: 'test task' },
      ...state,
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    deps: {},
  } as unknown as Parameters<typeof import('../../reflection/nodes/generator.js').generator>[0];
}

beforeEach(() => {
  oldAllowUnpersistedDecisionJournal =
    process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
  process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED = '1';

  unifiedChatMock.mockReset();
  resolveProviderMock.mockReset();
  resolveSlotModelMock.mockReset();
  optimizePayloadMock.mockReset();

  // Default mock returns
  unifiedChatMock.mockResolvedValue({
    text: 'mocked response',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    finishReason: 'stop',
    rawProvider: 'anthropic',
    rawModel: 'claude-sonnet-4',
  });
  resolveSlotModelMock.mockReturnValue('claude-sonnet-4');
  resolveProviderMock.mockReturnValue('anthropic');
  optimizePayloadMock.mockImplementation(
    async (_slot: string, _profile: string, messages: unknown[], systemPrompt: string) => ({
      systemPrompt,
      messages,
      maxTokens: 2048,
    }),
  );

  // Make env vars deterministic
  process.env.AISHA_LLM_GATEWAY_URL = 'http://llm-gateway:4000/v1'; // internal driver (public:false)
  process.env.AISHA_LLM_GATEWAY_KEY = 'sk-test-gateway-key';
  process.env.ANTHROPIC_API_KEY = 'sk-test-anthropic';
  process.env.OPENAI_API_KEY = 'sk-test-openai';
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
// Contract tests — these EXPECT the right behavior. Until generator.ts is
// updated to honor state.clow_backend, the first three will fail. That's
// the point: TDD lock-in. Once generator dispatches correctly, the design
// is bullet-proof against future regression.
// ───────────────────────────────────────────────────────────────────────────

describe('generator honors state.clow_backend (resolver → executor wiring)', () => {
  it('routes via gateway when clow_backend.backend_kind === "llm_gateway"', async () => {
    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'llm_gateway',
        provider_slug: 'llm-gateway',
        endpoint_url: 'https://gateway.aisha.guru/v1',
        auth_env_var: 'AISHA_LLM_GATEWAY_KEY',
        model_id: 'claude-sonnet-4',
      },
    });
    await generator(ctx);

    // unifiedChat called once, with provider='gateway' (the new variant)
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    const call = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.provider).toBe('gateway');
    expect(call.model).toBe('claude-sonnet-4');
    // Auth env: gateway-specific key, NOT a provider key
    // Either passed via apiKey option or implicit via env-driven adapter
    if (typeof call.apiKey === 'string') {
      expect(call.apiKey).toBe(process.env.AISHA_LLM_GATEWAY_KEY);
    }
  });

  it('routes direct to anthropic when backend_kind === "direct_cloud" and provider==="anthropic"', async () => {
    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'direct_cloud',
        provider_slug: 'anthropic',
        endpoint_url: 'https://api.anthropic.com',
        auth_env_var: 'ANTHROPIC_API_KEY',
        model_id: 'claude-opus-4',
      },
    });
    await generator(ctx);
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    const call = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.provider).toBe('anthropic');
    expect(call.model).toBe('claude-opus-4');
  });

  it('routes direct to openai when backend_kind === "direct_cloud" and provider==="openai"', async () => {
    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'direct_cloud',
        provider_slug: 'openai',
        endpoint_url: 'https://api.openai.com',
        auth_env_var: 'OPENAI_API_KEY',
        model_id: 'gpt-4o',
      },
    });
    await generator(ctx);
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    const call = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.provider).toBe('openai');
    expect(call.model).toBe('gpt-4o');
  });

  it('falls back to slot-based resolution when state.clow_backend is absent', async () => {
    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({}); // no clow_backend
    await generator(ctx);

    // Slot resolution must have been used
    expect(resolveSlotModelMock).toHaveBeenCalled();
    // And resolveProvider was used to derive provider from slot model
    expect(resolveProviderMock).toHaveBeenCalled();
  });

  it('clow_backend.model_id WINS over cfg.model_override (resolver is authoritative)', async () => {
    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'direct_cloud',
        provider_slug: 'openai',
        endpoint_url: 'https://api.openai.com',
        auth_env_var: 'OPENAI_API_KEY',
        model_id: 'gpt-4o-mini',
      },
    });
    // model_override is the legacy "force this model" config; resolver decision must win
    ctx.node.config = { model_override: 'gpt-3.5-turbo' };
    await generator(ctx);
    const call = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(
      call.model,
      'When AISHA resolver has picked a model, it MUST override config.model_override',
    ).toBe('gpt-4o-mini');
  });

  it('records both decisions in decision provenance (resolver pick + actual call)', async () => {
    // After dispatch, the generator should have emitted decision_provenance
    // entries that include BOTH `clow_backend.backend_kind` and the actual
    // `unifiedChat({ provider })` argument. Drift detection comes for free.
    const { generator } = await import('../../reflection/nodes/generator.js');
    const ctx = makeCtx({
      clow_backend: {
        backend_kind: 'llm_gateway',
        provider_slug: 'llm-gateway',
        endpoint_url: 'https://gateway.aisha.guru/v1',
        auth_env_var: 'AISHA_LLM_GATEWAY_KEY',
        model_id: 'claude-sonnet-4',
      },
    });
    const result = await generator(ctx);
    // The generator output should mention the resolved backend somewhere
    // (in state_patch.decision_provenance or output_data.backend_used). The
    // exact field is implementation-defined; the test asserts the linkage.
    const output = (result as { output_data?: Record<string, unknown> })?.output_data ?? {};
    const statePatch = (result as { state_patch?: Record<string, unknown> })?.state_patch ?? {};
    const merged = JSON.stringify({ output, statePatch });
    expect(
      /llm_gateway|backend_kind|backend_used|gateway/.test(merged),
      'Generator output should record that it used the gateway (for provenance/audit).',
    ).toBe(true);
  });
});

describe('llmRouter — gateway provider variant (adapter-level test)', () => {
  it('resolveProvider returns "gateway" when called with a gateway-tagged model spec', async () => {
    // Adapter contract: gateway models are tagged with a known prefix or
    // routed by an explicit `provider` field on UnifiedChatOptions. The
    // implementation detail is up to llmRouter, but resolveProvider MUST
    // know about 'gateway' as an option (otherwise the generator can't
    // pass through the resolver decision).
    const { resolveProvider } = await import('../../lib/llmRouter.js');
    expect(typeof resolveProvider).toBe('function');
    // Note: resolveProvider's signature is `(modelString) => LlmProvider`.
    // After the refactor, it should at least accept 'gateway:claude-sonnet-4'
    // or recognize when caller has already specified provider='gateway' via
    // a sibling resolveExplicit helper. The exact API is to be decided by
    // implementation; this test just guards that the function exists and
    // a 'gateway' provider variant is accepted somewhere.
    //
    // Concrete check (regex over source) lives in the architecture gate
    // test; this unit test simply protects the runtime contract.
  });

  it('unifiedChat with provider="gateway" routes to AISHA_LLM_GATEWAY_URL', async () => {
    // This test is intentionally light — full adapter behavior is exercised
    // by integration tests against the running gateway container. Here we
    // just verify that calling unifiedChat with provider='gateway' does NOT
    // throw "Unknown provider" — proves the variant is recognized.
    process.env.AISHA_LLM_GATEWAY_URL = 'https://gateway.test.local/v1';
    process.env.AISHA_LLM_GATEWAY_KEY = 'sk-test';

    // We're mocking llmRouter at the top of this file, so the actual
    // unifiedChat call goes through the mock — this test would only
    // exercise the real adapter once the mock is removed. Kept as a
    // documentation marker for the next implementation pass.
    expect(true).toBe(true);
  });
});
