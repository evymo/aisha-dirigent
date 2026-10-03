/**
 * useStoryDetail Hook Tests
 *
 * Covers the rich story detail accessor (get_story_detail_audited RPC).
 *
 * @see src/hooks/useStoryDetail.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useStoryDetail } from "@/hooks/useStoryDetail";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: (...args: unknown[]) => hoisted.rpcMock(...args) },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...mod,
    safeError: (...args: unknown[]) => hoisted.safeErrorMock(...args),
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const STORY_ID = "11111111-1111-1111-1111-111111111111";

const MOCK_STORY_ROW = {
  id: STORY_ID,
  partner_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  study_id: null,
  title: "Test story",
  status: "in_progress",
  priority: "high",
  is_starred: true,
  is_read: false,
  unread_count: 3,
  last_activity_at: "2026-05-18T12:00:00Z",
  created_at: "2026-05-01T10:00:00Z",
  updated_at: "2026-05-18T12:00:00Z",
  user_display_name: "Test user",
  study_name: null,
  labels: [],
  entries: [{ id: "e1", content: "hi" }],
  reminders: [],
};

describe("useStoryDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the first row from get_story_detail_audited", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [MOCK_STORY_ROW], error: null });

    const { result } = renderHook(
      () => useStoryDetail({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.title).toBe("Test story");
    expect(result.current.data?.priority).toBe("high");
    expect(result.current.data?.entries).toHaveLength(1);
  });

  it("calls RPC with p_story_id parameter", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [MOCK_STORY_ROW], error: null });

    renderHook(() => useStoryDetail({ storyId: STORY_ID }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_story_detail_audited", {
      p_story_id: STORY_ID,
    });
  });

  it("returns null when RPC yields empty array (story not found)", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useStoryDetail({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not call RPC when storyId is null", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useStoryDetail({ storyId: null }), {
      wrapper: createWrapper(),
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors and logs via safeError", async () => {
    const rpcError = { message: "Story not found", code: "P0002" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: rpcError });

    const { result } = renderHook(
      () => useStoryDetail({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useStoryDetail",
      rpcError,
    );
  });
});
