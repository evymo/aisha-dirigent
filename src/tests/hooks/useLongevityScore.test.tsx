/**
 * Tests for useLongevityScore hooks.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useLongevityScore,
  useLongevityScoreHistory,
  useSubmitLongevityAssessment,
  getTrendIconName,
  getScoreColorClass,
  getDomainName,
  calculateOverallImprovement,
  getDomainsNeedingAttention,
  getStrongestDomains,
  type DomainScore,
  type LongevityScoreHistoryEntry,
} from "@/hooks/useLongevityScore";
import { aisha } from "@/integrations/db/client";
import React from "react";

// Mock aisha
vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

// Mock useSession
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "test-user-id" },
    session: { access_token: "test-token" },
  }),
}));

// Mock toast (sonner)
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  }),
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback || key,
    i18n: { language: "en" },
  }),
}));

// Test wrapper
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// Mock data
const mockDomainScores: DomainScore[] = [
  {
    domain_code: "vitality",
    domain_name_key: "longevityScore.domains.vitality",
    questions_answered: 3,
    raw_score: 24,
    max_possible: 30,
    percentage: 77.8,
  },
  {
    domain_code: "energy",
    domain_name_key: "longevityScore.domains.energy",
    questions_answered: 3,
    raw_score: 21,
    max_possible: 30,
    percentage: 66.7,
  },
  {
    domain_code: "sleep",
    domain_name_key: "longevityScore.domains.sleep",
    questions_answered: 3,
    raw_score: 18,
    max_possible: 30,
    percentage: 55.6,
  },
];

const mockLongevityScoreResult = {
  response_id: "resp-123",
  user_id: "test-user-id",
  completed_at: "2024-01-15T10:00:00Z",
  cls_score: 66.7,
  domain_scores: mockDomainScores,
  trend_vs_baseline: 5.2,
  trend_direction: "improving",
};

const mockHistoryEntries: LongevityScoreHistoryEntry[] = [
  {
    response_id: "resp-3",
    completed_at: "2024-03-01T10:00:00Z",
    cls_score: 75.0,
    domain_scores: mockDomainScores,
    trend_vs_previous: 5.0,
  },
  {
    response_id: "resp-2",
    completed_at: "2024-02-01T10:00:00Z",
    cls_score: 70.0,
    domain_scores: mockDomainScores,
    trend_vs_previous: 10.0,
  },
  {
    response_id: "resp-1",
    completed_at: "2024-01-01T10:00:00Z",
    cls_score: 60.0,
    domain_scores: mockDomainScores,
    trend_vs_previous: null,
  },
];

describe("useLongevityScore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("useLongevityScore hook", () => {
    it("should return undefined when responseId is not provided", async () => {
      const { result } = renderHook(() => useLongevityScore(null), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // React Query returns undefined for disabled queries
        expect(result.current.data).toBeUndefined();
      });

      expect(vi.mocked(aisha.rpc)).not.toHaveBeenCalled();
    });

    it("should fetch longevity score for valid responseId", async () => {
      vi.mocked(aisha.rpc).mockResolvedValueOnce({
        data: mockLongevityScoreResult,
        error: null,
      } as never);

      const { result } = renderHook(() => useLongevityScore("resp-123"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
        "get_longevity_score_audited",
        { p_response_id: "resp-123" }
      );
      expect(result.current.data?.cls_score).toBe(66.7);
      expect(result.current.data?.trend_direction).toBe("improving");
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(aisha.rpc).mockResolvedValueOnce({
        data: null,
        error: { message: "Not found" },
      } as never);

      const { result } = renderHook(() => useLongevityScore("invalid-id"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useLongevityScoreHistory hook", () => {
    it("should fetch history for current user", async () => {
      vi.mocked(aisha.rpc).mockResolvedValueOnce({
        data: mockHistoryEntries,
        error: null,
      } as never);

      const { result } = renderHook(() => useLongevityScoreHistory(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
        "get_longevity_score_history_audited",
        { p_user_id: undefined, p_limit: 12 }
      );
      expect(result.current.data).toHaveLength(3);
      expect(result.current.data?.[0].cls_score).toBe(75.0);
    });

    it("should respect limit option", async () => {
      vi.mocked(aisha.rpc).mockResolvedValueOnce({
        data: mockHistoryEntries.slice(0, 2),
        error: null,
      } as never);

      const { result } = renderHook(() => useLongevityScoreHistory({ limit: 2 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
        "get_longevity_score_history_audited",
        { p_user_id: undefined, p_limit: 2 }
      );
    });

    it("should fetch history for specific user", async () => {
      vi.mocked(aisha.rpc).mockResolvedValueOnce({
        data: mockHistoryEntries,
        error: null,
      } as never);

      const { result } = renderHook(
        () => useLongevityScoreHistory({ userId: "other-user-id" }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
        "get_longevity_score_history_audited",
        { p_user_id: "other-user-id", p_limit: 12 }
      );
    });
  });

  describe("useSubmitLongevityAssessment hook", () => {
    it("should submit assessment and return result", async () => {
      vi.mocked(aisha.rpc).mockResolvedValueOnce({
        data: mockLongevityScoreResult,
        error: null,
      } as never);

      const { result } = renderHook(() => useSubmitLongevityAssessment(), {
        wrapper: createWrapper(),
      });

      const responses = {
        os_vitality_overall: 8,
        os_vitality_vs_peers: 7,
        os_vitality_trend: 9,
      };

      await result.current.mutateAsync({ responses });

      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
        "submit_longevity_assessment_audited",
        {
          p_responses: responses,
          p_study_registration_id: undefined,
        }
      );
    });

    it("should include study registration ID when provided", async () => {
      vi.mocked(aisha.rpc).mockResolvedValueOnce({
        data: mockLongevityScoreResult,
        error: null,
      } as never);

      const { result } = renderHook(() => useSubmitLongevityAssessment(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        responses: { os_vitality_overall: 8 },
        studyRegistrationId: "registration-123",
      });

      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
        "submit_longevity_assessment_audited",
        {
          p_responses: { os_vitality_overall: 8 },
          p_study_registration_id: "registration-123",
        }
      );
    });
  });
});

describe("Helper functions", () => {
  describe("getTrendIconName", () => {
    it("returns correct icon name for each direction", () => {
      expect(getTrendIconName("improving")).toBe("trending-up");
      expect(getTrendIconName("declining")).toBe("trending-down");
      expect(getTrendIconName("stable")).toBe("minus");
      expect(getTrendIconName(null)).toBe("");
    });
  });

  describe("getScoreColorClass", () => {
    it("should return correct color class for score ranges", () => {
      expect(getScoreColorClass(null)).toBe("text-muted-foreground");
      expect(getScoreColorClass(85)).toBe("text-green-600");
      expect(getScoreColorClass(65)).toBe("text-lime-600");
      expect(getScoreColorClass(45)).toBe("text-yellow-600");
      expect(getScoreColorClass(25)).toBe("text-orange-600");
      expect(getScoreColorClass(10)).toBe("text-red-600");
    });
  });

  describe("getDomainName", () => {
    it("should resolve domain name via t() function", () => {
      const domain = mockDomainScores[0];
      const mockT = (key: string) => {
        const translations: Record<string, string> = {
          "longevityScore.domains.vitality": "Vitalita",
          "longevityScore.domains.energy": "Energie",
          "longevityScore.domains.sleep": "Spánek",
        };
        return translations[key] ?? key;
      };
      expect(getDomainName(domain, "cs", mockT)).toBe("Vitalita");
    });

    it("should fallback to domain_name_key when t is not provided", () => {
      const domain = mockDomainScores[0];
      expect(getDomainName(domain, "en")).toBe("longevityScore.domains.vitality");
    });
  });

  describe("calculateOverallImprovement", () => {
    it("should calculate improvement from history", () => {
      const result = calculateOverallImprovement(mockHistoryEntries);

      expect(result.hasImproved).toBe(true);
      expect(result.totalChange).toBe(15); // 75 - 60
      expect(result.firstScore).toBe(60);
      expect(result.lastScore).toBe(75);
    });

    it("should handle single entry", () => {
      const result = calculateOverallImprovement([mockHistoryEntries[0]]);

      expect(result.hasImproved).toBe(false);
      expect(result.totalChange).toBe(0);
      expect(result.firstScore).toBe(75);
      expect(result.lastScore).toBe(75);
    });

    it("should handle empty array", () => {
      const result = calculateOverallImprovement([]);

      expect(result.hasImproved).toBe(false);
      expect(result.totalChange).toBe(0);
      expect(result.firstScore).toBeNull();
      expect(result.lastScore).toBeNull();
    });
  });

  describe("getDomainsNeedingAttention", () => {
    it("should return domains below threshold", () => {
      const domains: DomainScore[] = [
        { ...mockDomainScores[0], percentage: 30 },
        { ...mockDomainScores[1], percentage: 80 },
        { ...mockDomainScores[2], percentage: 45 },
      ];

      const result = getDomainsNeedingAttention(domains, 50);

      expect(result).toHaveLength(2);
      expect(result[0].percentage).toBe(30);
      expect(result[1].percentage).toBe(45);
    });

    it("should return empty array when all domains are above threshold", () => {
      const domains: DomainScore[] = [
        { ...mockDomainScores[0], percentage: 60 },
        { ...mockDomainScores[1], percentage: 80 },
      ];

      const result = getDomainsNeedingAttention(domains, 50);

      expect(result).toHaveLength(0);
    });
  });

  describe("getStrongestDomains", () => {
    it("should return domains above threshold", () => {
      const domains: DomainScore[] = [
        { ...mockDomainScores[0], percentage: 85 },
        { ...mockDomainScores[1], percentage: 75 },
        { ...mockDomainScores[2], percentage: 50 },
      ];

      const result = getStrongestDomains(domains, 70);

      expect(result).toHaveLength(2);
      expect(result[0].percentage).toBe(85);
      expect(result[1].percentage).toBe(75);
    });
  });
});
