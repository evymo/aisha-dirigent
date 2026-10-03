import { renderHook, waitFor } from "@testing-library/react-native";
import { useStoryRulesets, useStoryKnowledgeContext } from "@/hooks/useStoryContext";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeWarn: jest.fn() }));

describe("useStoryRulesets", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches + parses the active ruleset (story-parametrization)", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { ruleset_id: "11111111-1111-4111-8111-111111111111", context_profile: "clinical", rule_count: 12, ruleset_fingerprint: "abc" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useStoryRulesets("33333333-3333-4333-8333-333333333333"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_story_rulesets", { p_story_id: "33333333-3333-4333-8333-333333333333" });
    expect(result.current.data?.[0].context_profile).toBe("clinical");
    expect(result.current.data?.[0].rule_count).toBe(12);
  });

  it("degrades to empty when the RPC errors (no access)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });

    const { result } = renderHook(() => useStoryRulesets("33333333-3333-4333-8333-333333333333"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useStoryKnowledgeContext", () => {
  beforeEach(() => mockRpc.mockReset());

  it("passes p_context_tags and parses items", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "22222222-2222-4222-8222-222222222222", title: "Protocol", category: "study", has_ai_instructions: true }],
      error: null,
    });

    const { result } = renderHook(() => useStoryKnowledgeContext("33333333-3333-4333-8333-333333333333"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_story_knowledge_context", {
      p_story_id: "33333333-3333-4333-8333-333333333333",
      p_context_tags: [],
    });
    expect(result.current.data).toHaveLength(1);
  });
});
