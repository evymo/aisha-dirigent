import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useStories,
  useStoryDetail,
  useStoryStats,
  useStoryLabels,
  useCreateStory,
  useUpdateStoryStatus,
  useToggleStoryStar,
} from "@/hooks/useStoryLoop";

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

// Mock user
const mockUser = {
  id: "partner-user-id",
  email: "partner@example.com",
};

const mockUseSession = vi.fn();

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mockUseSession(),
}));

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

describe("useStories", () => {
  const mockStories = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      partner_id: "22222222-2222-2222-2222-222222222222",
      user_id: "33333333-3333-3333-3333-333333333331",
      study_id: null,
      title: "Případ 2026-02-01",
      status: "inbox",
      priority: "normal",
      is_starred: false,
      is_read: false,
      unread_count: 3,
      last_activity_at: "2026-02-01T10:00:00Z",
      created_at: "2026-02-01T09:00:00Z",
      user_display_name: "Jan N.",
      study_name: null,
      last_entry_preview: null,
      labels: [],
    },
    {
      id: "11111111-1111-1111-1111-111111111112",
      partner_id: "22222222-2222-2222-2222-222222222222",
      user_id: "33333333-3333-3333-3333-333333333332",
      study_id: "44444444-4444-4444-4444-444444444444",
      title: "Kontrola RTN-118",
      status: "in_progress",
      priority: "high",
      is_starred: true,
      is_read: true,
      unread_count: 0,
      last_activity_at: "2026-02-01T12:00:00Z",
      created_at: "2026-01-28T08:00:00Z",
      user_display_name: "Marie K.",
      study_name: "RTN-118 Study",
      last_entry_preview: "Poslední poznámka...",
      labels: [{ id: "55555555-5555-5555-5555-555555555555", label: "urgent", color: "red" }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      user: mockUser,
      session: { user: mockUser },
      isLoading: false,
    });

    mockRpc.mockResolvedValue({ data: mockStories, error: null });
  });

  it("should fetch stories successfully", async () => {
    const { result } = renderHook(() => useStories(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.error).toBe(null);
  });

  it("should call RPC with correct parameters", async () => {
    const filters = { status: "inbox", search: "test" };
    renderHook(() => useStories(filters), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("get_my_stories_audited", {
        p_status: "inbox",
        p_search: "test",
        p_labels: undefined,
        p_limit: 50,
        p_offset: 0,
      });
    });
  });

  it("should handle empty stories list", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useStories(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });

  it("should handle RPC error gracefully", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Database error" } });

    const { result } = renderHook(() => useStories(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
  });
});

describe("useStoryDetail", () => {
  const mockStoryDetail = {
    id: "11111111-1111-1111-1111-111111111111",
    partner_id: "22222222-2222-2222-2222-222222222222",
    user_id: "33333333-3333-3333-3333-333333333331",
    study_id: null,
    title: "Případ 2026-02-01",
    status: "inbox",
    priority: "normal",
    is_starred: false,
    is_read: true,
    unread_count: 0,
    last_activity_at: "2026-02-01T10:00:00Z",
    created_at: "2026-02-01T09:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    user_display_name: "Jan N.",
    study_name: null,
    labels: [],
    entries: [
      {
        id: "66666666-6666-6666-6666-666666666666",
        parent_id: null,
        entry_type: "note",
        content: "Initial consultation notes",
        metadata: {},
        is_internal: false,
        is_pinned: false,
        document_id: null,
        created_at: "2026-02-01T09:30:00Z",
        created_by: "77777777-7777-7777-7777-777777777777",
        created_by_name: "Partner Name",
        document_preview: null,
      },
    ],
    reminders: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      user: mockUser,
      session: { user: mockUser },
      isLoading: false,
    });

    // RPC returns array
    mockRpc.mockResolvedValue({ data: [mockStoryDetail], error: null });
  });

  it("should fetch story detail successfully", async () => {
    const { result } = renderHook(() => useStoryDetail("11111111-1111-1111-1111-111111111111"), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data?.id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("should not fetch when storyId is null", async () => {
    const { result } = renderHook(() => useStoryDetail(null), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("should return null for non-existent story", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useStoryDetail("99999999-9999-9999-9999-999999999999"), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBe(null);
  });
});

describe("useStoryStats", () => {
  const mockStats = {
    active_count: 1,
    inbox_count: 5,
    in_progress_count: 3,
    scheduled_count: 2,
    archived_count: 10,
    starred_count: 4,
    unread_total: 8,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: [mockStats], error: null });
  });

  it("should fetch stats successfully", async () => {
    const { result } = renderHook(() => useStoryStats(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockStats);
  });

  it("should return default stats on error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Error" } });

    const { result } = renderHook(() => useStoryStats(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
  });
});

describe("useStoryLabels", () => {
  const mockLabels = [
    { label: "urgent", color: "red", story_count: 3 },
    { label: "follow-up", color: "blue", story_count: 5 },
    { label: "completed", color: "green", story_count: 10 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      user: mockUser,
      session: { user: mockUser },
      isLoading: false,
    });

    mockRpc.mockResolvedValue({ data: mockLabels, error: null });
  });

  it("should fetch labels successfully", async () => {
    const { result } = renderHook(() => useStoryLabels(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toHaveLength(3);
  });

  it("should not fetch when user is not logged in", async () => {
    mockUseSession.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
    });

    const { result } = renderHook(() => useStoryLabels(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("useCreateStory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: "new-story-id", error: null });
  });

  it("should create story successfully", async () => {
    const { result } = renderHook(() => useCreateStory(), { wrapper: createWrapper() });

    await waitFor(async () => {
      const storyId = await result.current.mutateAsync({
        user_id: "user-001",
        study_id: "study-001",
        title: "Test story",
      });

      expect(storyId).toBe("new-story-id");
    });

    expect(mockRpc).toHaveBeenCalledWith("create_story_audited", {
      p_user_id: "user-001",
      p_study_id: "study-001",
      p_title: "Test story",
    });
  });

  it("should handle create error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "No consent" } });

    const { result } = renderHook(() => useCreateStory(), { wrapper: createWrapper() });

    await expect(
      result.current.mutateAsync({
        user_id: "user-001",
      })
    ).rejects.toThrow();
  });
});

describe("useUpdateStoryStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: true, error: null });
  });

  it("should update story status successfully", async () => {
    const { result } = renderHook(() => useUpdateStoryStatus(), { wrapper: createWrapper() });

    await waitFor(async () => {
      await result.current.mutateAsync({
        story_id: "story-001",
        status: "in_progress",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_story_status_audited", {
      p_story_id: "story-001",
      p_status: "in_progress",
    });
  });
});

describe("useToggleStoryStar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: true, error: null });
  });

  it("should toggle story star successfully", async () => {
    const { result } = renderHook(() => useToggleStoryStar(), { wrapper: createWrapper() });

    await waitFor(async () => {
      await result.current.mutateAsync("story-001");
    });

    expect(mockRpc).toHaveBeenCalledWith("toggle_story_star_audited", {
      p_story_id: "story-001",
    });
  });
});
