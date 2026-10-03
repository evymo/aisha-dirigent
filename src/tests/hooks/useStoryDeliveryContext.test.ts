import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useStoryDeliveryContext,
  useCreateStoryRuleset,
  useUpdateStoryDeliveryContext,
  useUpdateStoryProjectPreview,
} from "@/hooks/useStoryDeliveryContext";

// Create wrapper with QueryClientProvider
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// Mock Supabase RPC
const mockRpc = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// Mock safeError
vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: vi.fn(),
  };
});

// =====================================================
// Test Data
// =====================================================

const storyId = "11111111-1111-1111-1111-111111111111";
const ruleId1 = "aaaa0000-0000-0000-0000-000000000001";
const ruleId2 = "aaaa0000-0000-0000-0000-000000000002";
const rulesetId = "bbbb0000-0000-0000-0000-000000000001";
const participantId = "cccc0000-0000-0000-0000-000000000001";
const createdById = "dddd0000-0000-0000-0000-000000000001";

const mockDeliveryContext = {
  story: {
    id: storyId,
    title: "Test Project",
    status: "in_progress",
    delivery_status: "planning",
    repo_url: "https://github.com/org/repo",
    repo_provider: "github",
    default_branch: "main",
    tech_stack: ["react", "typescript"],
    domain: ["web"],
    project_preview: {
      constraints: [],
      success_criteria: [],
      summary: "MVP preview",
      goals: ["fast iteration"],
    },
    risk_profile: "medium",
    origin: "manual",
  },
  project_preview: {
    constraints: [],
    success_criteria: [],
    summary: "MVP preview",
    goals: ["fast iteration"],
  },
  ruleset: {
    id: rulesetId,
    fingerprint: "abc123def456",
    rule_count: 2,
    context_profile: "web-frontend",
    rule_versions: { [ruleId1]: 3, [ruleId2]: 1 },
    created_at: "2026-02-28T20:00:00Z",
  },
  build_config: {
    mcp_endpoint: null,
    mcp_token_id: null,
    build_config: null,
    env_hints: null,
  },
  participants: [
    {
      user_id: participantId,
      role: "lead",
      joined_at: "2026-02-28T20:00:00Z",
    },
  ],
  rules_preview: [
    {
      id: ruleId1,
      title: "Code Review Guidelines",
      version: 3,
      expertise_area: "development",
    },
    {
      id: ruleId2,
      title: "Security Standards",
      version: 1,
      expertise_area: "security",
    },
  ],
};

const mockCreatedRuleset = {
  id: "eeee0000-0000-0000-0000-000000000001",
  story_id: storyId,
  ruleset_fingerprint: "abc123def456abc123def456abc123def456abc123def456abc123def456abcd1234",
  rule_ids: [ruleId1, ruleId2],
  rule_versions: { [ruleId1]: 3, [ruleId2]: 1 },
  context_profile: "web-frontend",
  created_at: "2026-02-28T21:00:00Z",
  created_by: createdById,
};

// =====================================================
// Tests: useStoryDeliveryContext
// =====================================================

describe("useStoryDeliveryContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch story delivery context", async () => {
    mockRpc.mockResolvedValue({ data: mockDeliveryContext, error: null });

    const { result } = renderHook(() => useStoryDeliveryContext(storyId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("mcp_get_story_context", {
      p_story_id: storyId,
    });
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.story.id).toBe(storyId);
    expect(result.current.data?.project_preview).toBeTruthy();
    expect(result.current.data?.ruleset?.fingerprint).toBe("abc123def456");
    expect(result.current.data?.participants).toHaveLength(1);
    expect(result.current.data?.rules_preview).toHaveLength(2);
  });

  it("should not fetch when storyId is null", () => {
    const { result } = renderHook(() => useStoryDeliveryContext(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("should return null for story without context", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useStoryDeliveryContext(storyId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("should handle RPC errors", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Story not found" },
    });

    const { result } = renderHook(() => useStoryDeliveryContext(storyId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Story not found");
  });

  it("should handle null ruleset gracefully", async () => {
    const contextNoRuleset = { ...mockDeliveryContext, ruleset: null };
    mockRpc.mockResolvedValue({ data: contextNoRuleset, error: null });

    const { result } = renderHook(() => useStoryDeliveryContext(storyId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.ruleset).toBeNull();
    expect(result.current.data?.story.delivery_status).toBe("planning");
  });
});

// =====================================================
// Tests: useCreateStoryRuleset
// =====================================================

describe("useCreateStoryRuleset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a ruleset with fingerprint", async () => {
    mockRpc.mockResolvedValue({ data: mockCreatedRuleset, error: null });

    const { result } = renderHook(() => useCreateStoryRuleset(), {
      wrapper: createWrapper(),
    });

    let ruleset: unknown;
    await act(async () => {
      ruleset = await result.current.mutateAsync({
        story_id: storyId,
        rule_ids: [ruleId1, ruleId2],
        context_profile: "web-frontend",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("create_story_ruleset", {
      p_story_id: storyId,
      p_rule_ids: [ruleId1, ruleId2],
      p_context_profile: "web-frontend",
    });
    expect(ruleset).toEqual(expect.objectContaining({
      id: mockCreatedRuleset.id,
      ruleset_fingerprint: mockCreatedRuleset.ruleset_fingerprint,
      rule_ids: [ruleId1, ruleId2],
    }));
  });

  it("should create a ruleset without context_profile", async () => {
    mockRpc.mockResolvedValue({ data: mockCreatedRuleset, error: null });

    const { result } = renderHook(() => useCreateStoryRuleset(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        story_id: storyId,
        rule_ids: [ruleId1],
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("create_story_ruleset", {
      p_story_id: storyId,
      p_rule_ids: [ruleId1],
    });
  });

  it("should handle RPC error on create", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Unauthorized" },
    });

    const { result } = renderHook(() => useCreateStoryRuleset(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          story_id: storyId,
          rule_ids: [ruleId1],
        }),
      ),
    ).rejects.toThrow("Unauthorized");
  });
});

// =====================================================
// Tests: useUpdateStoryDeliveryContext
// =====================================================

describe("useUpdateStoryDeliveryContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should update delivery context partially", async () => {
    mockRpc.mockResolvedValue({
      data: { repo_url: "https://github.com/org/new-repo", tech_stack: ["react"] },
      error: null,
    });

    const { result } = renderHook(() => useUpdateStoryDeliveryContext(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        story_id: storyId,
        repo_url: "https://github.com/org/new-repo",
        tech_stack: ["react"],
      });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "update_story_delivery_context",
      expect.objectContaining({
        p_story_id: storyId,
        p_repo_url: "https://github.com/org/new-repo",
        p_tech_stack: ["react"],
      }),
    );
  });

  it("should handle full delivery context update", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useUpdateStoryDeliveryContext(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        story_id: storyId,
        repo_url: "https://github.com/org/repo",
        repo_provider: "github",
        default_branch: "develop",
        delivery_status: "in_progress",
        tech_stack: ["react", "node"],
        risk_profile: "high",
        domain: ["fintech", "web"],
        build_config: { node_version: "20" },
        env_hints: { DATABASE_URL: "required" },
      });
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "update_story_delivery_context",
      expect.objectContaining({
        p_story_id: storyId,
        p_repo_url: "https://github.com/org/repo",
        p_repo_provider: "github",
        p_default_branch: "develop",
        p_delivery_status: "in_progress",
        p_tech_stack: ["react", "node"],
        p_risk_profile: "high",
        p_domain: ["fintech", "web"],
        p_build_config: { node_version: "20" },
        p_env_hints: { DATABASE_URL: "required" },
      }),
    );
  });

  it("should not send undefined params", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useUpdateStoryDeliveryContext(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        story_id: storyId,
        repo_url: "https://github.com/org/repo",
      });
    });

    const callArgs = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).toHaveProperty("p_story_id");
    expect(callArgs).toHaveProperty("p_repo_url");
    expect(callArgs).not.toHaveProperty("p_tech_stack");
    expect(callArgs).not.toHaveProperty("p_domain");
    expect(callArgs).not.toHaveProperty("p_build_config");
  });

  it("should handle RPC error on update", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Permission denied" },
    });

    const { result } = renderHook(() => useUpdateStoryDeliveryContext(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          story_id: storyId,
          delivery_status: "delivered",
        }),
      ),
    ).rejects.toThrow("Permission denied");
  });
});

// =====================================================
// Tests: useUpdateStoryProjectPreview
// =====================================================

describe("useUpdateStoryProjectPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should update project preview in story", async () => {
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    const { result } = renderHook(() => useUpdateStoryProjectPreview(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        story_id: storyId,
        project_preview: {
          constraints: [],
          summary: "Updated summary",
          goals: ["Goal A", "Goal B"],
          success_criteria: [],
        },
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_story_project_preview", {
      p_story_id: storyId,
      p_project_preview: {
        constraints: [],
        summary: "Updated summary",
        goals: ["Goal A", "Goal B"],
        success_criteria: [],
      },
      p_publish: false,
    });
  });

  it("should publish project preview when requested", async () => {
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });

    const { result } = renderHook(() => useUpdateStoryProjectPreview(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        story_id: storyId,
        publish: true,
        project_preview: {
          constraints: [],
          summary: "Publish summary",
          goals: [],
          success_criteria: ["Criteria 1"],
        },
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_story_project_preview", {
      p_story_id: storyId,
      p_project_preview: {
        constraints: [],
        summary: "Publish summary",
        goals: [],
        success_criteria: ["Criteria 1"],
      },
      p_publish: true,
    });
  });

  it("should handle RPC error on preview update", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Unauthorized" },
    });

    const { result } = renderHook(() => useUpdateStoryProjectPreview(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          story_id: storyId,
          project_preview: {
            constraints: [],
            goals: [],
            success_criteria: [],
            summary: "x",
          },
        }),
      ),
    ).rejects.toThrow("Unauthorized");
  });
});
