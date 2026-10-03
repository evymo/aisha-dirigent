import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useStoryParticipants,
  useAddStoryParticipant,
  useRemoveStoryParticipant,
} from "@/hooks/useStoryParticipants";

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

const storyId = "11111111-1111-1111-1111-111111111111";

const mockParticipants = [
  {
    user_id: "aaaa0000-0000-0000-0000-000000000001",
    role: "member",
    joined_at: "2026-03-01T10:00:00Z",
    display_name: "Jan N.",
    avatar_url: null,
    certification_level: null,
    business_name: null,
  },
  {
    user_id: "aaaa0000-0000-0000-0000-000000000002",
    role: "guild_expert",
    joined_at: "2026-03-02T10:00:00Z",
    display_name: "Marie K.",
    avatar_url: "https://example.com/avatar.png",
    certification_level: "certified_provider",
    business_name: "Firma s.r.o.",
  },
];

// =====================================================
// useStoryParticipants
// =====================================================

describe("useStoryParticipants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches participants via RPC", async () => {
    mockRpc.mockResolvedValue({ data: mockParticipants, error: null });

    const { result } = renderHook(() => useStoryParticipants(storyId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_story_participants_audited", {
      p_story_id: storyId,
    });
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].role).toBe("member");
    expect(result.current.data?.[1].role).toBe("guild_expert");
  });

  it("returns empty array for null storyId", async () => {
    const { result } = renderHook(() => useStoryParticipants(null), {
      wrapper: createWrapper(),
    });

    // Should not even be enabled
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Permission denied" } });

    const { result } = renderHook(() => useStoryParticipants(storyId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Permission denied");
  });

  it("handles Zod validation failure gracefully", async () => {
    // Invalid data — missing required fields
    mockRpc.mockResolvedValue({
      data: [{ user_id: "not-uuid", unexpected_field: true }],
      error: null,
    });

    const { result } = renderHook(() => useStoryParticipants(storyId), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // parseRpcArraySafe drops invalid — returns empty
    expect(result.current.data).toEqual([]);
  });
});

// =====================================================
// useAddStoryParticipant
// =====================================================

describe("useAddStoryParticipant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls add_story_participant_audited RPC with correct params", async () => {
    const addResult = { success: true, story_id: storyId, target_user_id: "user-2", role: "guild_expert" };
    mockRpc.mockResolvedValue({ data: addResult, error: null });

    const { result } = renderHook(() => useAddStoryParticipant(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        story_id: storyId,
        target_user_id: "user-2",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("add_story_participant_audited", {
      p_role: "guild_expert",
      p_story_id: storyId,
      p_target_user_id: "user-2",
    });
  });

  it("uses custom role when provided", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, story_id: storyId, target_user_id: "user-2", role: "partner" },
      error: null,
    });

    const { result } = renderHook(() => useAddStoryParticipant(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        story_id: storyId,
        target_user_id: "user-2",
        role: "partner",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("add_story_participant_audited", {
      p_role: "partner",
      p_story_id: storyId,
      p_target_user_id: "user-2",
    });
  });

  it("handles RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "User not certified" } });

    const { result } = renderHook(() => useAddStoryParticipant(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        story_id: storyId,
        target_user_id: "user-3",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("User not certified");
  });
});

// =====================================================
// useRemoveStoryParticipant
// =====================================================

describe("useRemoveStoryParticipant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls remove_story_participant_audited RPC", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, story_id: storyId, removed_user_id: "user-2" },
      error: null,
    });

    const { result } = renderHook(() => useRemoveStoryParticipant(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        story_id: storyId,
        target_user_id: "user-2",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("remove_story_participant_audited", {
      p_story_id: storyId,
      p_target_user_id: "user-2",
    });
  });

  it("handles last owner error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Cannot remove the last owner" },
    });

    const { result } = renderHook(() => useRemoveStoryParticipant(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        story_id: storyId,
        target_user_id: "owner-id",
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Cannot remove the last owner");
  });
});
