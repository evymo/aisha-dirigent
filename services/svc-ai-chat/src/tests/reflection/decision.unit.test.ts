/**
 * E0.1 — reflection/decision.ts unit tests (the AishaExecutionDecision SoT).
 *
 * Locks three things:
 *   1. resolveModelWithClow() priority: clow_backend > model_override > slot
 *      (AISHA's resolver decision is authoritative).
 *   2. mapBackendKindToProvider() — the model-transport → LlmProvider map,
 *      promoted verbatim out of generator.ts.
 *   3. The two-axis orthogonality: AISHA_RUNTIMES ∩ BACKEND_KINDS = ∅, and the
 *      Zod schema treats `runtime` as a required executor discriminant that does
 *      NOT accept a backend_kind value (e.g. 'llm_gateway' is a transport, not a
 *      runtime).
 *
 * Pure-function tests; we mock only the two leaf resolvers so we can assert the
 * priority branches deterministically.
 *
 * @module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const resolveProviderMock = vi.hoisted(() => vi.fn());
const resolveSlotModelMock = vi.hoisted(() => vi.fn());
const { mockRpc, safeWarn, safeError } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  safeWarn: vi.fn(),
  safeError: vi.fn(),
}));

vi.mock("@aisha/security", () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn, safeError, safeDebug: vi.fn() }),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));
vi.mock("../../lib/llmRouter.js", () => ({
  resolveProvider: resolveProviderMock,
  resolveAvailableModel: (m: string) => ({ model: m, provider: resolveProviderMock(m) }),
}));
vi.mock("../../reflection/soulforge.js", () => ({
  resolveSlotModel: resolveSlotModelMock,
}));
vi.mock("../../reflection/postgrest.js", () => ({ rpc: mockRpc }));

const oldAllowUnpersisted = process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;

beforeEach(() => {
  resolveProviderMock.mockReset();
  resolveSlotModelMock.mockReset();
  mockRpc.mockReset();
  safeWarn.mockReset();
  safeError.mockReset();
  resolveProviderMock.mockReturnValue("openai"); // sentinel fallback
  resolveSlotModelMock.mockReturnValue("slot-model-xyz");
  delete process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
});

afterEach(() => {
  if (oldAllowUnpersisted === undefined) delete process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED;
  else process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED = oldAllowUnpersisted;
});

// ──────────────────────────────────────────────────────────────────────────
// mapBackendKindToProvider — model-transport → LlmProvider
// ──────────────────────────────────────────────────────────────────────────
describe("mapBackendKindToProvider", () => {
  it("llm_gateway → 'gateway'", async () => {
    const { mapBackendKindToProvider } = await import(
      "../../reflection/decision.js"
    );
    expect(
      mapBackendKindToProvider({ backend_kind: "llm_gateway", model_id: "x" }),
    ).toBe("gateway");
  });

  it("local_ollama → 'ollama', local_vllm → 'vllm'", async () => {
    const { mapBackendKindToProvider } = await import(
      "../../reflection/decision.js"
    );
    expect(
      mapBackendKindToProvider({ backend_kind: "local_ollama", model_id: "x" }),
    ).toBe("ollama");
    expect(
      mapBackendKindToProvider({ backend_kind: "local_vllm", model_id: "x" }),
    ).toBe("vllm");
  });

  it("direct_cloud + provider_slug picks anthropic/openai/google", async () => {
    const { mapBackendKindToProvider } = await import(
      "../../reflection/decision.js"
    );
    expect(
      mapBackendKindToProvider({
        backend_kind: "direct_cloud",
        provider_slug: "anthropic",
        model_id: "claude-x",
      }),
    ).toBe("anthropic");
    expect(
      mapBackendKindToProvider({
        backend_kind: "direct_cloud",
        provider_slug: "openai",
        model_id: "gpt-x",
      }),
    ).toBe("openai");
    expect(
      mapBackendKindToProvider({
        backend_kind: "direct_cloud",
        provider_slug: "google-genai",
        model_id: "gemini-x",
      }),
    ).toBe("google");
  });

  // ⛔ 2026-09-13: dřív „unknown backend_kind falls back to resolveProvider(model_id)" —
  // tedy o provideru modelu z resolveru rozhodoval prefix id. clow_backend je řádek
  // registru: slug rozhoduje, a když ho proces nezná (nebo chybí), je to chyba, ne odhad.
  it("unknown backend_kind + known slug → provider from the registry row, never the id prefix", async () => {
    const { mapBackendKindToProvider } = await import(
      "../../reflection/decision.js"
    );
    expect(
      mapBackendKindToProvider({ backend_kind: "mcp_server", provider_slug: "xai", model_id: "bez-prefixu" }),
    ).toBe("xai");
    expect(
      mapBackendKindToProvider({ backend_kind: "direct_cloud", provider_slug: "vllm-local", model_id: "default-lens" }),
    ).toBe("vllm");
    expect(resolveProviderMock).not.toHaveBeenCalled();
  });

  it("⛔ slug the process does not serve, or no slug at all → throws (no prefix guess)", async () => {
    const { mapBackendKindToProvider } = await import(
      "../../reflection/decision.js"
    );
    expect(() =>
      mapBackendKindToProvider({ backend_kind: "direct_cloud", provider_slug: "mistral", model_id: "gpt-looking-id" }),
    ).toThrow(/neobsluhuje/);
    expect(() => mapBackendKindToProvider({ backend_kind: "???", model_id: "maestro-y" })).toThrow(/neobsluhuje/);
    expect(resolveProviderMock).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// resolveModelWithClow — the resolver-first priority chain
// ──────────────────────────────────────────────────────────────────────────
describe("resolveModelWithClow priority chain", () => {
  it("clow_backend.model_id WINS over model_override (resolver is authoritative)", async () => {
    const { resolveModelWithClow } = await import(
      "../../reflection/decision.js"
    );
    const out = await resolveModelWithClow({
      clowBackend: {
        backend_kind: "direct_cloud",
        provider_slug: "openai",
        model_id: "gpt-4o",
      },
      modelOverride: "gpt-3.5-turbo",
      slot: "ember",
      profile: "balanced",
    });
    expect(out.model).toBe("gpt-4o");
    expect(out.provider).toBe("openai");
    expect(out.resolution_source).toBe("clow_backend");
    // Resolver decided — the slot resolver must not even be consulted.
    expect(resolveSlotModelMock).not.toHaveBeenCalled();
  });

  it("falls to model_override when clow_backend absent", async () => {
    const { resolveModelWithClow } = await import(
      "../../reflection/decision.js"
    );
    resolveProviderMock.mockReturnValue("anthropic");
    const out = await resolveModelWithClow({
      clowBackend: undefined,
      modelOverride: "claude-opus-4",
      slot: "ember",
      profile: "balanced",
    });
    expect(out.model).toBe("claude-opus-4");
    expect(out.provider).toBe("anthropic");
    expect(out.resolution_source).toBe("model_override");
  });

  it("falls to slot resolution when neither clow_backend nor model_override present", async () => {
    const { resolveModelWithClow } = await import(
      "../../reflection/decision.js"
    );
    const out = await resolveModelWithClow({
      clowBackend: undefined,
      modelOverride: undefined,
      slot: "verify",
      profile: "maxQuality",
    });
    expect(resolveSlotModelMock).toHaveBeenCalledWith("verify", "maxQuality");
    expect(out.model).toBe("slot-model-xyz");
    expect(out.resolution_source).toBe("slot");
  });

  it("treats a clow_backend WITHOUT model_id as no decision (slot fallback)", async () => {
    const { resolveModelWithClow } = await import(
      "../../reflection/decision.js"
    );
    const out = await resolveModelWithClow({
      clowBackend: { backend_kind: "direct_cloud", provider_slug: "openai" },
      modelOverride: undefined,
      slot: "ember",
      profile: "balanced",
    });
    expect(out.resolution_source).toBe("slot");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Two-axis orthogonality + schema discipline (the crux)
// ──────────────────────────────────────────────────────────────────────────
describe("runtime vs backend_kind orthogonality", () => {
  it("AISHA_RUNTIMES and BACKEND_KINDS are disjoint sets", async () => {
    const { AISHA_RUNTIMES, BACKEND_KINDS } = await import(
      "../../reflection/decision.js"
    );
    const overlap = AISHA_RUNTIMES.filter((r: string) =>
      (BACKEND_KINDS as readonly string[]).includes(r),
    );
    expect(
      overlap,
      `runtime and backend_kind must not share values; overlap=${overlap.join(",")}`,
    ).toEqual([]);
  });

  it("runtime carries the executor discriminants; backend_kind carries transports", async () => {
    const { AISHA_RUNTIMES, BACKEND_KINDS } = await import(
      "../../reflection/decision.js"
    );
    expect(AISHA_RUNTIMES).toContain("openclaw");
    expect(AISHA_RUNTIMES).toContain("hermes");
    expect(AISHA_RUNTIMES).toContain("direct_llm");
    // llm_gateway is a TRANSPORT, not a runtime — it must live only on the
    // backend_kind axis (the executor for a gateway call is still direct_llm).
    expect(BACKEND_KINDS).toContain("llm_gateway");
    expect(AISHA_RUNTIMES).not.toContain("llm_gateway");
  });
});

describe("AishaExecutionDecisionSchema", () => {
  it("requires `runtime` and accepts a minimal valid decision", async () => {
    const { AishaExecutionDecisionSchema } = await import(
      "../../reflection/decision.js"
    );
    const ok = AishaExecutionDecisionSchema.safeParse({
      runtime: "openclaw",
      resolution_source: "policy",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a missing runtime", async () => {
    const { AishaExecutionDecisionSchema } = await import(
      "../../reflection/decision.js"
    );
    const bad = AishaExecutionDecisionSchema.safeParse({
      resolution_source: "slot",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a backend_kind value used as runtime (e.g. 'llm_gateway')", async () => {
    const { AishaExecutionDecisionSchema } = await import(
      "../../reflection/decision.js"
    );
    const bad = AishaExecutionDecisionSchema.safeParse({
      runtime: "llm_gateway",
      resolution_source: "slot",
    });
    expect(
      bad.success,
      "'llm_gateway' is a transport, not a runtime — schema must reject it as runtime",
    ).toBe(false);
  });

  it("allows backend_kind to be ABSENT for non-LLM runtimes (human/hermes)", async () => {
    const { AishaExecutionDecisionSchema } = await import(
      "../../reflection/decision.js"
    );
    const ok = AishaExecutionDecisionSchema.safeParse({
      runtime: "human",
      resolution_source: "policy",
      approval_required: true,
    });
    expect(ok.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// recordExecutionDecision — I1 audit completeness, not UUID-shaped soft-fail
// ──────────────────────────────────────────────────────────────────────────
describe("recordExecutionDecision", () => {
  const decision = {
    runtime: "direct_llm" as const,
    resolution_source: "slot" as const,
    model_id: "gpt-4o-mini",
    provider_slug: "openai",
  };

  it("returns the durable id from fn_record_execution_decision", async () => {
    const { recordExecutionDecision } = await import("../../reflection/decision.js");
    mockRpc.mockResolvedValueOnce("decision-123");

    await expect(recordExecutionDecision(decision, "run-1", "story-1")).resolves.toBe("decision-123");
    expect(mockRpc).toHaveBeenCalledWith("fn_record_execution_decision", {
      p_decision: decision,
      p_run_id: "run-1",
      p_story_id: "story-1",
    });
  });

  it("fails closed when the journal RPC throws", async () => {
    const { recordExecutionDecision } = await import("../../reflection/decision.js");
    mockRpc.mockRejectedValueOnce(new Error("db down"));

    await expect(recordExecutionDecision(decision)).rejects.toThrow(/refusing dispatch without durable decision_id/);
    expect(safeError).toHaveBeenCalledWith(
      expect.stringContaining("failed to persist execution decision"),
      expect.any(Error),
      expect.objectContaining({ runtime: "direct_llm", model_id: "gpt-4o-mini" }),
    );
  });

  it("fails closed when the RPC returns no durable id", async () => {
    const { recordExecutionDecision } = await import("../../reflection/decision.js");
    mockRpc.mockResolvedValueOnce("");

    await expect(recordExecutionDecision(decision)).rejects.toThrow(/returned no decision_id/);
  });

  it("allows an unpersisted id only via AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED=1", async () => {
    const { recordExecutionDecision } = await import("../../reflection/decision.js");
    process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED = "1";
    mockRpc.mockRejectedValueOnce(new Error("local db offline"));

    const id = await recordExecutionDecision(decision);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(safeWarn).toHaveBeenCalledWith(
      expect.stringContaining("unpersisted decision id issued"),
      expect.objectContaining({ decision_id: id, error: "local db offline" }),
    );
  });
});
