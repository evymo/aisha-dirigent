import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useTrackedActions } from "@/hooks/useTrackedActions";

// --- Mocks ---

const mockUser = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

vi.mock("@/hooks/useSession", () => ({
  useSession: vi.fn(() => ({ user: mockUser })),
}));

const mockRpc = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

// --- Helpers ---

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// --- Tests ---
//
// Fixtures are domain-neutral on purpose: they assert the universal
// action_type / occurred_at / source / payload contract, not any specific
// tracked-action theme.

describe("useTrackedActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches tracked actions via the universal RPC and validates the shape", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          action_type: "reminder",
          occurred_at: "2026-01-01T10:00:00.000Z",
          reminder_id: "22222222-2222-2222-2222-222222222222",
          source: "reminder_completion",
          source_id: "11111111-1111-1111-1111-111111111111",
          payload: { done: true, points_awarded: 10 },
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useTrackedActions({ actionType: "reminder", limit: 50 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith("get_my_tracked_actions", {
      p_since: undefined,
      p_action_type: "reminder",
      p_limit: 50,
    });
    expect(result.current.data).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        action_type: "reminder",
        occurred_at: "2026-01-01T10:00:00.000Z",
        reminder_id: "22222222-2222-2222-2222-222222222222",
        source: "reminder_completion",
        source_id: "11111111-1111-1111-1111-111111111111",
        payload: { done: true, points_awarded: 10 },
      },
    ]);
  });

  it("returns an empty list when a row breaks the universal contract", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "not-a-uuid", action_type: 123 }],
      error: null,
    });

    const { result } = renderHook(() => useTrackedActions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});
