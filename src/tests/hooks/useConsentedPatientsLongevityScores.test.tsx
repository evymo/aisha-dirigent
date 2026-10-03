/**
 * Tests for useConsentedUsersLongevityScores hook
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock Supabase
vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

// Mock useSession
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "test-user-id" },
    isLoading: false,
  }),
}));

import { aisha } from "@/integrations/db/client";
import {
  useConsentedUsersLongevityScores,
  useConsentedUsersScoreStats,
} from "@/hooks/useConsentedUsersLongevityScores";

// Helper to create query client wrapper
function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe("useConsentedUsersLongevityScores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty array when no data", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(
      () => useConsentedUsersLongevityScores(),
      { wrapper: createQueryWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });

  it("should fetch and parse user scores", async () => {
    const mockData = [
      {
        user_id: "user-1",
        display_name: "John Doe",
        overall_score: 75.5,
        trend: "up",
        trend_percentage: 5.2,
        domains: { vitality: 80, energy: 70 },
        assessed_at: "2024-01-15T10:00:00Z",
        assessment_count: 3,
      },
      {
        user_id: "user-2",
        display_name: "Jane Smith",
        overall_score: 62.3,
        trend: "down",
        trend_percentage: 2.1,
        domains: { sleep: 60, cognitive: 65 },
        assessed_at: "2024-01-14T10:00:00Z",
        assessment_count: 5,
      },
    ];

    vi.mocked(aisha.rpc).mockResolvedValue({
      data: mockData,
      error: null,
    });

    const { result } = renderHook(
      () => useConsentedUsersLongevityScores(),
      { wrapper: createQueryWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
      expect(result.current.data?.length).toBe(2);
    });

    expect(result.current.data?.[0]).toEqual({
      user_id: "user-1",
      display_name: "John Doe",
      overall_score: 75.5,
      trend: "up",
      trend_percentage: 5.2,
      domains: { vitality: 80, energy: 70 },
      assessed_at: "2024-01-15T10:00:00Z",
      assessment_count: 3,
    });

    expect(aisha.rpc).toHaveBeenCalledWith(
      "get_consented_users_longevity_scores",
      { p_limit: 50 }
    );
  });

  it("should handle neutral trend for invalid trend values", async () => {
    const mockData = [
      {
        user_id: "user-1",
        display_name: "Test User",
        overall_score: 50,
        trend: "invalid",
        trend_percentage: 0,
        domains: {},
        assessed_at: "2024-01-15T10:00:00Z",
        assessment_count: 1,
      },
    ];

    vi.mocked(aisha.rpc).mockResolvedValue({
      data: mockData,
      error: null,
    });

    const { result } = renderHook(
      () => useConsentedUsersLongevityScores(),
      { wrapper: createQueryWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data?.[0]?.trend).toBe("neutral");
    });
  });

  it("should handle RPC errors", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: { message: "Database error", code: "500" },
    });

    const { result } = renderHook(
      () => useConsentedUsersLongevityScores(),
      { wrapper: createQueryWrapper() }
    );

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
  });

  it("should respect custom limit parameter", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [],
      error: null,
    });

    renderHook(
      () => useConsentedUsersLongevityScores(25),
      { wrapper: createQueryWrapper() }
    );

    await waitFor(() => {
      expect(aisha.rpc).toHaveBeenCalledWith(
        "get_consented_users_longevity_scores",
        { p_limit: 25 }
      );
    });
  });
});

describe("useConsentedUsersScoreStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should calculate aggregate statistics", async () => {
    const mockData = [
      {
        user_id: "user-1",
        display_name: "User 1",
        overall_score: 80,
        trend: "up",
        trend_percentage: 5,
        domains: {},
        assessed_at: "2024-01-15T10:00:00Z",
        assessment_count: 3,
      },
      {
        user_id: "user-2",
        display_name: "User 2",
        overall_score: 60,
        trend: "down",
        trend_percentage: 2,
        domains: {},
        assessed_at: "2024-01-14T10:00:00Z",
        assessment_count: 2,
      },
      {
        user_id: "user-3",
        display_name: "User 3",
        overall_score: 70,
        trend: "neutral",
        trend_percentage: 0,
        domains: {},
        assessed_at: "2024-01-13T10:00:00Z",
        assessment_count: 4,
      },
    ];

    vi.mocked(aisha.rpc).mockResolvedValue({
      data: mockData,
      error: null,
    });

    const { result } = renderHook(
      () => useConsentedUsersScoreStats(),
      { wrapper: createQueryWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats).not.toBeNull();
    expect(result.current.stats).toEqual({
      avgScore: 70,
      minScore: 60,
      maxScore: 80,
      totalUsers: 3,
      improving: 1,
      declining: 1,
      stable: 1,
    });
  });

  it("should return null stats when no data", async () => {
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(
      () => useConsentedUsersScoreStats(),
      { wrapper: createQueryWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats).toBeNull();
  });
});
