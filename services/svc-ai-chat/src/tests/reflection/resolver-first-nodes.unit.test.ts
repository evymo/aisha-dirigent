/**
 * E0.2 — resolver-first dispatch for the three ex-sovereign LLM nodes.
 *
 * Before E0.2, only `generator` honored `state.clow_backend`; `critic`,
 * `corrector` and `occipitum` resolved their own model via
 * `cfg.model_override ?? resolveSlotModel(slot, profile)` — usurping AISHA's
 * routing authority. This test locks the contract that ALL THREE now route
 * through the shared resolver and honor a present `clow_backend`.
 *
 * TDD lock-in: these fail until each node adopts resolveModelWithClow().
 *
 * @module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const unifiedChatMock = vi.hoisted(() => vi.fn());
const resolveProviderMock = vi.hoisted(() => vi.fn());
const resolveSlotModelMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/llmRouter.js", () => ({
  unifiedChat: unifiedChatMock,
  resolveProvider: resolveProviderMock,
  resolveAvailableModel: (m: string) => ({ model: m, provider: resolveProviderMock(m) }),
}));
vi.mock("../../reflection/soulforge.js", () => ({
  resolveSlotModel: resolveSlotModelMock,
}));
vi.mock("@aisha/security", () => ({
  createSafeLogger: () => ({
    safeInfo: vi.fn(),
    safeWarn: vi.fn(),
    safeError: vi.fn(),
    safeDebug: vi.fn(),
  }),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

function makeRun() {
  return {
    id: "run-1",
    kind: "reflection",
    story_id: null,
    actor_user_id: null,
    status: "running",
    workflow_definition_id: "wf-1",
    metadata: {
      input: { description: "improve the onboarding copy", agent_slug: "aisha" },
      context: { profile: "balanced" },
      checkpoint: { current_node: null, iteration: 0, history: [], state: {} },
    },
    cost_total_json: {},
  };
}

function makeCtx(state: Record<string, unknown>) {
  return {
    run: makeRun(),
    node: { id: "n-1", type: "x", config: {} },
    state,
    iteration: 1,
  } as unknown as Parameters<
    typeof import("../../reflection/nodes/critic.js").critic
  >[0];
}

const CLOW = {
  backend_kind: "direct_cloud",
  provider_slug: "openai",
  model_id: "gpt-4o",
};

let oldAllowUnpersistedDecisionJournal: string | undefined;

beforeEach(() => {
  oldAllowUnpersistedDecisionJournal =
    process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
  process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED = "1";

  unifiedChatMock.mockReset();
  resolveProviderMock.mockReset();
  resolveSlotModelMock.mockReset();
  unifiedChatMock.mockResolvedValue({
    text: '{"scores":{"compliance":0.9},"feedback":"looks good"}',
    model: "echoed-model",
    provider: "echoed-provider",
    usage: { inputTokens: 5, outputTokens: 7 },
  });
  resolveProviderMock.mockReturnValue("anthropic");
  resolveSlotModelMock.mockReturnValue("slot-fallback-model");
});

afterEach(() => {
  if (oldAllowUnpersistedDecisionJournal === undefined) {
    delete process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
  } else {
    process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED =
      oldAllowUnpersistedDecisionJournal;
  }
});

// ──────────────────────────────────────────────────────────────────────────
// critic
// ──────────────────────────────────────────────────────────────────────────
describe("critic honors state.clow_backend", () => {
  it("dispatches with the resolver-picked model+provider when clow_backend present", async () => {
    const { critic } = await import("../../reflection/nodes/critic.js");
    await critic(makeCtx({ last_generation: "draft text", clow_backend: CLOW }));
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    const call = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.model).toBe("gpt-4o");
    expect(call.provider).toBe("openai");
    expect(resolveSlotModelMock).not.toHaveBeenCalled();
  });

  it("falls back to slot resolution when clow_backend absent", async () => {
    const { critic } = await import("../../reflection/nodes/critic.js");
    await critic(makeCtx({ last_generation: "draft text" }));
    expect(resolveSlotModelMock).toHaveBeenCalled();
    const call = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.model).toBe("slot-fallback-model");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// corrector
// ──────────────────────────────────────────────────────────────────────────
describe("corrector honors state.clow_backend", () => {
  it("dispatches with the resolver-picked model+provider when clow_backend present", async () => {
    const { corrector } = await import("../../reflection/nodes/corrector.js");
    await corrector(
      makeCtx({
        last_generation: "prior output",
        last_critic_feedback: "fix tone",
        clow_backend: CLOW,
      }),
    );
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    const call = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.model).toBe("gpt-4o");
    expect(call.provider).toBe("openai");
    expect(resolveSlotModelMock).not.toHaveBeenCalled();
  });

  it("falls back to slot resolution when clow_backend absent", async () => {
    const { corrector } = await import("../../reflection/nodes/corrector.js");
    await corrector(
      makeCtx({ last_generation: "prior output", last_critic_feedback: "fix tone" }),
    );
    expect(resolveSlotModelMock).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// occipitum_creative
// ──────────────────────────────────────────────────────────────────────────
describe("occipitumCreative honors state.clow_backend", () => {
  it("dispatches with the resolver-picked model+provider when clow_backend present", async () => {
    const { occipitumCreative } = await import(
      "../../reflection/nodes/occipitum.js"
    );
    await occipitumCreative(makeCtx({ clow_backend: CLOW }));
    expect(unifiedChatMock).toHaveBeenCalledTimes(1);
    const call = unifiedChatMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.model).toBe("gpt-4o");
    expect(call.provider).toBe("openai");
    expect(resolveSlotModelMock).not.toHaveBeenCalled();
  });

  it("falls back to slot resolution when clow_backend absent", async () => {
    const { occipitumCreative } = await import(
      "../../reflection/nodes/occipitum.js"
    );
    await occipitumCreative(makeCtx({}));
    expect(resolveSlotModelMock).toHaveBeenCalled();
  });
});
