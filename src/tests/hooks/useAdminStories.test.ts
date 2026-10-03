import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  hasPermissionMock: vi.fn(() => true),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    permissions: ["view_admin_dashboard"],
    isLoading: false,
    hasPermission: hoisted.hasPermissionMock,
    hasAllPermissions: vi.fn(() => true),
    hasAnyPermission: vi.fn(() => true),
  }),
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  safeError: vi.fn(),
}));

import { useAdminStories } from "@/hooks/useAdminStories";
import type { AdminStoryListItem } from "@/schemas/storyLoopSchemas";

/* ── Helpers ──────────────────────────────────────────────────── */

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const MOCK_STORY: Record<string, unknown> = {
  id: "a0000000-0000-4000-8000-000000000001",
  partner_id: "b0000000-0000-4000-8000-000000000001",
  user_id: "c0000000-0000-4000-8000-000000000001",
  study_id: "d0000000-0000-4000-8000-000000000001",
  title: "Story 1",
  status: "inbox",
  priority: "normal",
  is_starred: false,
  is_read: false,
  unread_count: 3,
  last_activity_at: "2026-02-19T10:00:00Z",
  created_at: "2026-02-01T10:00:00Z",
  user_display_name: "Jan N.",
  partner_display_name: "Clinic Alpha",
  study_name: "Study A",
  last_entry_preview: "Last message preview text",
  labels: [{ id: "e0000000-0000-4000-8000-000000000001", label: "follow-up", color: "#ff0000" }],
  entry_count: 5,
  total_count: 42,
};

const MOCK_STORY_2: Record<string, unknown> = {
  ...MOCK_STORY,
  id: "a0000000-0000-4000-8000-000000000002",
  user_id: "c0000000-0000-4000-8000-000000000002",
  user_display_name: "Eva S.",
  partner_display_name: "Clinic Beta",
  title: "Story 2",
  status: "in_progress",
  entry_count: 12,
  total_count: 42,
};

/* ── Tests ────────────────────────────────────────────────────── */

describe("useAdminStories", () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    hoisted.hasPermissionMock.mockReset();
    hoisted.hasPermissionMock.mockReturnValue(true);
  });

  it("should return stories from RPC", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: [MOCK_STORY, MOCK_STORY_2],
      error: null,
    });

    const { result } = renderHook(() => useAdminStories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const data = result.current.data;
    expect(data).toBeDefined();
    expect(data!.items).toHaveLength(2);
    expect(data!.totalCount).toBe(42);
    expect(data!.items[0].id).toBe("a0000000-0000-4000-8000-000000000001");
    expect(data!.items[1].id).toBe("a0000000-0000-4000-8000-000000000002");
  });

  it("should call RPC with correct default parameters", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useAdminStories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(hoisted.rpcMock).toHaveBeenCalled();
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "get_all_stories_admin_audited",
      expect.objectContaining({
        p_limit: 50,
        p_offset: 0,
      }),
    );
  });

  it("should pass filters to RPC", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [MOCK_STORY], error: null });

    renderHook(
      () =>
        useAdminStories({
          limit: 20,
          offset: 40,
          search: "jan",
          status: "inbox",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(hoisted.rpcMock).toHaveBeenCalled();
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "get_all_stories_admin_audited",
      expect.objectContaining({
        p_limit: 20,
        p_offset: 40,
        p_search: "jan",
        p_status: "inbox",
      }),
    );
  });

  it("should return empty result when no data", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useAdminStories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ items: [], totalCount: 0 });
  });

  it("should return empty result when data is null", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useAdminStories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ items: [], totalCount: 0 });
  });

  it("should not query when user has no permission", async () => {
    hoisted.hasPermissionMock.mockReturnValue(false);

    const { result } = renderHook(() => useAdminStories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe("idle");
    });

    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("should handle RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Permission denied" },
    });

    const { result } = renderHook(() => useAdminStories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeTruthy();
  });

  it("should return empty result when Zod validation fails (invalid data)", async () => {
    const invalidData = [{ id: "not-a-uuid", WRONG_FIELD: 123 }];
    hoisted.rpcMock.mockResolvedValue({ data: invalidData, error: null });

    const { result } = renderHook(() => useAdminStories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // safeParse fails → empty result (no crash)
    expect(result.current.data).toEqual({ items: [], totalCount: 0 });
  });

  it("should validate story fields via Zod schema", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: [MOCK_STORY],
      error: null,
    });

    const { result } = renderHook(() => useAdminStories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const item = result.current.data!.items[0] as AdminStoryListItem;
    expect(item.id).toBe("a0000000-0000-4000-8000-000000000001");
    expect(item.user_display_name).toBe("Jan N.");
    expect(item.partner_display_name).toBe("Clinic Alpha");
    expect(item.entry_count).toBe(5);
    expect(item.total_count).toBe(42);
    expect(item.labels).toHaveLength(1);
    expect(item.labels[0].label).toBe("follow-up");
  });
});
