import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { RewardPointsCard } from "@/components/gamification/RewardPointsCard";

// --- Mocks ---

const mockStats = {
  best_streak: 14,
  current_streak: 5,
  monthly_points: 200,
  monthly_rank: 3,
  total_check_ins: 30,
  total_completions: 15,
  total_points: 750,
  weekly_points: 80,
  weekly_rank: 1,
};

const mockUseGamificationStats = vi.fn(
  (): {
    error: null;
    isLoading: boolean;
    refetch: () => void;
    stats: typeof mockStats | null;
  } => ({
    error: null,
    isLoading: false,
    refetch: vi.fn(),
    stats: mockStats,
  })
);

vi.mock("@/hooks/useGamificationStats", () => ({
  useGamificationStats: () => mockUseGamificationStats(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// --- Helpers ---

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(RewardPointsCard)
    )
  );
}

// --- Tests ---

describe("RewardPointsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGamificationStats.mockReturnValue({
      error: null,
      isLoading: false,
      refetch: vi.fn(),
      stats: mockStats,
    });
  });

  it("renders total points prominently", () => {
    renderCard();
    expect(screen.getByText("750")).toBeInTheDocument();
  });

  it("renders weekly and monthly points", () => {
    renderCard();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("renders current streak", () => {
    renderCard();
    expect(screen.getByText("gamification.rewardPoints.currentStreak")).toBeInTheDocument();
  });

  it("renders best streak when greater than current", () => {
    renderCard();
    expect(screen.getByText("gamification.rewardPoints.bestStreak")).toBeInTheDocument();
  });

  it("hides best streak when equal to current", () => {
    mockUseGamificationStats.mockReturnValue({
      error: null,
      isLoading: false,
      refetch: vi.fn(),
      stats: { ...mockStats, best_streak: 5 },
    });

    renderCard();
    expect(screen.queryByText("gamification.rewardPoints.bestStreak")).not.toBeInTheDocument();
  });

  it("shows empty state when no points", () => {
    mockUseGamificationStats.mockReturnValue({
      error: null,
      isLoading: false,
      refetch: vi.fn(),
      stats: { ...mockStats, total_points: 0 },
    });

    renderCard();
    expect(screen.getByText("gamification.rewardPoints.noData")).toBeInTheDocument();
  });

  it("shows loading skeleton when loading", () => {
    mockUseGamificationStats.mockReturnValue({
      error: null,
      isLoading: true,
      refetch: vi.fn(),
      stats: null,
    });

    const { container } = renderCard();
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows empty state when stats is null", () => {
    mockUseGamificationStats.mockReturnValue({
      error: null,
      isLoading: false,
      refetch: vi.fn(),
      stats: null,
    });

    renderCard();
    expect(screen.getByText("gamification.rewardPoints.noData")).toBeInTheDocument();
  });
});
