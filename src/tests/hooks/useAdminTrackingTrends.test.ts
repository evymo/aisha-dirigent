import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { TrendGranularity, RangePreset } from "@/hooks/useAdminTrackingTrends";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    permissions: ["view_admin_dashboard"],
    isLoading: false,
    hasPermission: mockHasPermission,
    hasAllPermissions: vi.fn(() => true),
    hasAnyPermission: vi.fn(() => true),
  }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "test-admin-id" },
    session: { user: { id: "test-admin-id" } },
    isLoading: false,
    hasRole: vi.fn(() => true),
    roles: ["admin"],
    isAdmin: true,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

/* ── Helpers ──────────────────────────────────────────────────── */

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

const MOCK_TRENDS = [
  {
    avg_energy: 6.5,
    avg_mood: 7.0,
    avg_pain: 3.2,
    avg_sleep: 6.8,
    check_in_count: 45,
    period_start: "2025-07-01",
    unique_users: 12,
  },
  {
    avg_energy: 6.8,
    avg_mood: 7.2,
    avg_pain: 3.0,
    avg_sleep: 7.1,
    check_in_count: 52,
    period_start: "2025-08-01",
    unique_users: 14,
  },
  {
    avg_energy: 7.0,
    avg_mood: 6.9,
    avg_pain: 2.8,
    avg_sleep: 7.3,
    check_in_count: 60,
    period_start: "2025-09-01",
    unique_users: 15,
  },
  {
    avg_energy: 7.2,
    avg_mood: 7.5,
    avg_pain: 2.5,
    avg_sleep: 7.5,
    check_in_count: 65,
    period_start: "2025-10-01",
    unique_users: 16,
  },
];

/* ── Tests ────────────────────────────────────────────────────── */

describe("useAdminTrackingTrends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("should return periods from RPC", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.periods).toHaveLength(4);
    expect(result.current.periods[0].avgPain).toBe(3.2);
    expect(result.current.periods[0].periodStart).toBe("2025-07-01");
    expect(result.current.periods[0].checkInCount).toBe(45);
    expect(mockRpc).toHaveBeenCalledWith(
      "get_admin_health_trends_audited",
      expect.objectContaining({
        p_granularity: "monthly",
      }),
    );
  });

  it("should compute totals across all periods", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // avgPain = (3.2+3.0+2.8+2.5)/4 = 2.875
    expect(result.current.totals.avgPain).toBeCloseTo(2.875, 2);
    expect(result.current.totals.totalCheckIns).toBe(45 + 52 + 60 + 65);
  });

  it("should compute trend comparison between older and recent halves", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // older: [0,1] (Jul, Aug), recent: [2,3] (Sep, Oct)
    // Pain: older avg = (3.2+3.0)/2=3.1, recent avg = (2.8+2.5)/2=2.65
    // delta = 2.65 - 3.1 = -0.45 → trend "down" (pain going down is good)
    expect(result.current.comparison.pain.trend).toBe("down");
    expect(result.current.comparison.pain.delta).toBeCloseTo(-0.45, 1);

    // Energy: older avg = (6.5+6.8)/2=6.65, recent avg = (7.0+7.2)/2=7.1
    // ratio = 7.1/6.65 ≈ 1.068 → <1.1 → neutral
    expect(result.current.comparison.energy.trend).toBe("neutral");
  });

  it("should return neutral comparison when fewer than 2 periods", async () => {
    mockRpc.mockResolvedValue({
      data: [MOCK_TRENDS[0]],
      error: null,
    });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.comparison.pain.trend).toBe("neutral");
    expect(result.current.comparison.pain.delta).toBeNull();
  });

  it("should handle RPC error gracefully", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("permission denied");
    expect(result.current.periods).toEqual([]);
  });

  it("should handle empty data gracefully", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.periods).toEqual([]);
    expect(result.current.totals.totalCheckIns).toBe(0);
    expect(result.current.totals.avgPain).toBe(0);
  });

  it("should handle null metric values", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          avg_energy: null,
          avg_mood: null,
          avg_pain: null,
          avg_sleep: null,
          check_in_count: 0,
          period_start: "2025-07-01",
          unique_users: 0,
        },
      ],
      error: null,
    });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.periods[0].avgPain).toBeNull();
    expect(result.current.periods[0].avgEnergy).toBeNull();
  });

  it("should allow changing granularity", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.granularity).toBe("monthly");

    act(() => {
      result.current.setGranularity("weekly");
    });

    expect(result.current.granularity).toBe("weekly");
  });

  it("should allow changing preset range", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.preset).toBe("1y");

    act(() => {
      result.current.setPreset("3m");
    });

    expect(result.current.preset).toBe("3m");
  });

  it("should not fetch when user lacks permission", async () => {
    mockHasPermission.mockReturnValue(false);
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    // Wait a tick to allow any potential fetch
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.periods).toEqual([]);
  });

  it("should silently discard invalid rows via Zod validation", async () => {
    mockRpc.mockResolvedValue({
      data: [
        MOCK_TRENDS[0],
        { broken: true }, // invalid row
        MOCK_TRENDS[1],
      ],
      error: null,
    });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // parseRpcArray uses safeParse — invalid rows are silently dropped
    expect(result.current.periods).toHaveLength(2);
  });

  it("should accept initial options", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(
      () => useAdminTrackingTrends({ granularity: "weekly", preset: "6m" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.granularity).toBe("weekly");
    expect(result.current.preset).toBe("6m");
    expect(mockRpc).toHaveBeenCalledWith(
      "get_admin_health_trends_audited",
      expect.objectContaining({
        p_granularity: "weekly",
      }),
    );
  });

  it("should navigate back/forward through presets", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(
      () => useAdminTrackingTrends({ preset: "6m" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.preset).toBe("6m");

    // Navigate back → 1y
    act(() => {
      result.current.navigateBack();
    });
    expect(result.current.preset).toBe("1y");

    // Navigate forward → 6m
    act(() => {
      result.current.navigateForward();
    });
    expect(result.current.preset).toBe("6m");

    // Navigate forward → 3m
    act(() => {
      result.current.navigateForward();
    });
    expect(result.current.preset).toBe("3m");

    // Navigate forward at minimum → stays 3m
    act(() => {
      result.current.navigateForward();
    });
    expect(result.current.preset).toBe("3m");
  });

  it("should pass filter params to RPC when filters are set", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(
      () =>
        useAdminTrackingTrends({
          filters: { studyId: "study-123", gender: "female", checkInType: "morning" },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "get_admin_health_trends_audited",
      expect.objectContaining({
        p_study_id: "study-123",
        p_gender: "female",
        p_check_in_type: "morning",
      }),
    );
  });

  it("should pass age range filter params to RPC", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(
      () =>
        useAdminTrackingTrends({
          filters: { ageMin: 31, ageMax: 50 },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "get_admin_health_trends_audited",
      expect.objectContaining({
        p_age_min: 31,
        p_age_max: 50,
      }),
    );
  });

  it("should not include null filter params in RPC call", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const rpcArgs = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs).not.toHaveProperty("p_study_id");
    expect(rpcArgs).not.toHaveProperty("p_gender");
    expect(rpcArgs).not.toHaveProperty("p_check_in_type");
    expect(rpcArgs).not.toHaveProperty("p_age_min");
    expect(rpcArgs).not.toHaveProperty("p_age_max");
  });

  it("should report hasActiveFilters correctly", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // No filters active initially
    expect(result.current.hasActiveFilters).toBe(false);

    // Set a filter
    act(() => {
      result.current.updateFilter("studyId", "study-abc");
    });
    expect(result.current.hasActiveFilters).toBe(true);
    expect(result.current.filters.studyId).toBe("study-abc");
  });

  it("should clear all filters via clearFilters", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(
      () =>
        useAdminTrackingTrends({
          filters: { studyId: "study-x", gender: "male", ageMin: 18, ageMax: 30 },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasActiveFilters).toBe(true);

    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.filters.studyId).toBeNull();
    expect(result.current.filters.gender).toBeNull();
    expect(result.current.filters.ageMin).toBeNull();
    expect(result.current.filters.ageMax).toBeNull();
  });

  it("should allow updating individual filter fields", async () => {
    mockRpc.mockResolvedValue({ data: MOCK_TRENDS, error: null });

    const { useAdminTrackingTrends } = await import("@/hooks/useAdminTrackingTrends");
    const { result } = renderHook(() => useAdminTrackingTrends(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateFilter("gender", "female");
    });
    expect(result.current.filters.gender).toBe("female");

    act(() => {
      result.current.updateFilter("checkInType", "evening");
    });
    expect(result.current.filters.checkInType).toBe("evening");
    // Previous filter still set
    expect(result.current.filters.gender).toBe("female");
  });
});
