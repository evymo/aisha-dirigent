import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useGamificationStats, GAMIFICATION_STATS_QUERY_KEY } from "@/hooks/useGamificationStats";

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

describe("useGamificationStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches gamification stats via RPC", async () => {
    mockRpc.mockResolvedValue({
      data: {
        best_streak: 7,
        current_streak: 3,
        monthly_points: 150,
        monthly_rank: 5,
        total_check_ins: 20,
        total_completions: 10,
        total_points: 500,
        weekly_points: 50,
        weekly_rank: 2,
      },
      error: null,
    });

    const { result } = renderHook(() => useGamificationStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).toHaveBeenCalledWith("get_my_gamification_stats");
    expect(result.current.stats).toEqual({
      best_streak: 7,
      current_streak: 3,
      monthly_points: 150,
      monthly_rank: 5,
      total_check_ins: 20,
      total_completions: 10,
      total_points: 500,
      weekly_points: 50,
      weekly_rank: 2,
    });
  });

  it("returns null when RPC returns null data", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useGamificationStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stats).toBeNull();
  });

  it("handles RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "RPC error", code: "42000" },
    });

    const { result } = renderHook(() => useGamificationStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("coerces numeric fields and handles nullish ranks", async () => {
    mockRpc.mockResolvedValue({
      data: {
        best_streak: "5",
        current_streak: null,
        monthly_points: "100",
        monthly_rank: null,
        total_check_ins: "15",
        total_completions: "8",
        total_points: "300",
        weekly_points: "25",
        weekly_rank: null,
      },
      error: null,
    });

    const { result } = renderHook(() => useGamificationStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stats).toEqual({
      best_streak: 5,
      current_streak: 0,
      monthly_points: 100,
      monthly_rank: undefined,
      total_check_ins: 15,
      total_completions: 8,
      total_points: 300,
      weekly_points: 25,
      weekly_rank: undefined,
    });
  });

  it("exports correct query key", () => {
    expect(GAMIFICATION_STATS_QUERY_KEY).toEqual(["gamification-stats"]);
  });
});
