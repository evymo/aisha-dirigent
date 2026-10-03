/**
 * useAllowedKanbanTransitions Hook Tests
 *
 * Covers per-story drag-drop validation (get_allowed_kanban_transitions RPC).
 *
 * @see src/hooks/useAllowedKanbanTransitions.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAllowedKanbanTransitions } from "@/hooks/useAllowedKanbanTransitions";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const STORY_ID = "11111111-1111-1111-1111-111111111111";

const MOCK_TRANSITIONS = [
  { to_status: "in_progress", requires_role: null },
  { to_status: "scheduled", requires_role: null },
  { to_status: "archived", requires_role: null },
];

describe("useAllowedKanbanTransitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed transitions for a story", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: MOCK_TRANSITIONS, error: null });

    const { result } = renderHook(
      () => useAllowedKanbanTransitions({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    expect(result.current.data?.[0].to_status).toBe("in_progress");
  });

  it("calls RPC with p_story_id parameter", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useAllowedKanbanTransitions({ storyId: STORY_ID }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "get_allowed_kanban_transitions",
      { p_story_id: STORY_ID },
    );
  });

  it("does not call RPC when storyId is null", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useAllowedKanbanTransitions({ storyId: null }), {
      wrapper: createWrapper(),
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("does not call RPC when explicitly disabled", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(
      () => useAllowedKanbanTransitions({ storyId: STORY_ID, enabled: false }),
      { wrapper: createWrapper() },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("preserves requires_role on admin-gated transitions", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: [{ to_status: "inbox", requires_role: "admin" }],
      error: null,
    });

    const { result } = renderHook(
      () => useAllowedKanbanTransitions({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].requires_role).toBe("admin");
  });

  it("surfaces RPC errors and logs via safeError", async () => {
    const rpcError = { message: "Story not found", code: "P0002" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: rpcError });

    const { result } = renderHook(
      () => useAllowedKanbanTransitions({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useAllowedKanbanTransitions",
      rpcError,
    );
  });
});
