/**
 * useOperationalAssessment Hook Tests
 * 
 * Tests for the operational assessment persistence hook including:
 * - Assessment creation
 * - Dimension saving
 * - Assessment completion
 * - Data retrieval (audited)
 * - Error handling
 * - Helper functions (scoreToDbFormat, dbToScoreFormat)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useOperationalAssessment, scoreToDbFormat, dbToScoreFormat } from "@/hooks/useOperationalAssessment";
import { aisha } from "@/integrations/db/client";
import type { LongevityScore, DimensionScore, Dimension } from "@/components/assessment/types";

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

describe("useOperationalAssessment", () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe("startAssessment", () => {
    it("should create a new assessment via RPC", async () => {
      const mockAssessmentId = "assessment-123";
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: mockAssessmentId,
        error: null,
      } as never);

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      let assessmentId: string | undefined;
      await act(async () => {
        assessmentId = await result.current.startAssessment("onboarding");
      });

      expect(aisha.rpc).toHaveBeenCalledWith("create_operational_assessment", {
        p_assessment_type: "onboarding",
      });
      expect(assessmentId).toBe(mockAssessmentId);
    });

    it("should handle assessment creation error", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: null,
        error: { message: "Database error" },
      } as never);

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      await act(async () => {
        await expect(result.current.startAssessment()).rejects.toThrow();
      });
    });

    it("should use default assessment type 'onboarding'", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: "assessment-456",
        error: null,
      } as never);

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      await act(async () => {
        await result.current.startAssessment();
      });

      expect(aisha.rpc).toHaveBeenCalledWith("create_operational_assessment", {
        p_assessment_type: "onboarding",
      });
    });
  });

  describe("saveDimension", () => {
    it("should save dimension score via RPC", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: true,
        error: null,
      } as never);

      const dimensionScore: DimensionScore = {
        dimension: "VIT",
        rawScore: 8,
        normalizedScore: 80,
        tagCount: 3,
        hasNegativeIndicators: false,
        operationalFlags: ["flag1"],
      };

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      await act(async () => {
        await result.current.saveDimension("assessment-123", dimensionScore);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("save_operational_assessment_dimension", {
        p_assessment_id: "assessment-123",
        p_dimension: "VIT",
        p_raw_score: 8,
        p_normalized_score: 80,
        p_tag_count: 3,
        p_has_negative_indicators: false,
        p_operational_flags: ["flag1"],
        p_tag_ids: [],
        p_follow_up_answers: [],
      });
    });

    it("should handle dimension save error", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: null,
        error: { message: "Save failed" },
      } as never);

      const dimensionScore: DimensionScore = {
        dimension: "ENE",
        rawScore: 5,
        normalizedScore: 50,
        tagCount: 2,
        hasNegativeIndicators: true,
        operationalFlags: [],
      };

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      await act(async () => {
        await expect(
          result.current.saveDimension("assessment-123", dimensionScore)
        ).rejects.toThrow();
      });
    });
  });

  describe("completeAssessment", () => {
    const mockScore: LongevityScore = {
      overall: 75,
      dimensions: [
        { 
          dimension: "VIT" as Dimension, 
          rawScore: 8, 
          normalizedScore: 80, 
          tagCount: 3, 
          hasNegativeIndicators: false, 
          operationalFlags: [] 
        },
      ],
      interpretation: "good",
      alertFlags: ["VIT" as Dimension],
      assessmentDate: new Date("2024-12-20"),
    };

    it("should complete assessment via RPC with score data", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: true,
        error: null,
      } as never);

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      await act(async () => {
        await result.current.completeAssessment("assessment-123", mockScore);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("complete_operational_assessment", {
        p_assessment_id: "assessment-123",
        p_overall_score: 75,
        p_interpretation: "good",
        p_alert_flags: ["VIT"],
        p_has_critical_flags: true,
      });
    });

    it("should set has_critical_flags to false when no alerts", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: true,
        error: null,
      } as never);

      const scoreNoAlerts: LongevityScore = {
        ...mockScore,
        alertFlags: [],
      };

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      await act(async () => {
        await result.current.completeAssessment("assessment-123", scoreNoAlerts);
      });

      expect(aisha.rpc).toHaveBeenCalledWith("complete_operational_assessment", {
        p_assessment_id: "assessment-123",
        p_overall_score: 75,
        p_interpretation: "good",
        p_alert_flags: [],
        p_has_critical_flags: false,
      });
    });

    it("should invalidate queries after completion", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: true,
        error: null,
      } as never);

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      await act(async () => {
        await result.current.completeAssessment("assessment-123", mockScore);
      });

      expect(invalidateSpy).toHaveBeenCalled();
    });
  });

  describe("latestAssessment query", () => {
    it("should fetch latest assessment via audited RPC", async () => {
      const mockRecord = {
        id: "assessment-123",
        overall_score: 75,
        interpretation: "good",
        alert_flags: [],
        dimensions: [],
        completed_at: "2024-12-20T10:00:00Z",
      };

      vi.mocked(aisha.rpc).mockResolvedValue({
        data: [mockRecord],
        error: null,
      } as never);

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      await waitFor(() => {
        expect(aisha.rpc).toHaveBeenCalledWith("get_my_latest_operational_assessment_audited");
      });
    });

    it("should return null when no assessment exists", async () => {
      vi.mocked(aisha.rpc).mockResolvedValue({
        data: [],
        error: null,
      } as never);

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      await waitFor(() => {
        expect(result.current.latestAssessment).toBeNull();
      });
    });
  });

  describe("mutation states", () => {
    it("should track creating state", async () => {
      // Create a promise we can control
      let resolveRpc: (value: unknown) => void;
      const rpcPromise = new Promise((resolve) => {
        resolveRpc = resolve;
      });
      
      vi.mocked(aisha.rpc).mockReturnValue(rpcPromise as never);

      const { result } = renderHook(() => useOperationalAssessment(), { wrapper });

      // Start mutation but don't await
      let mutationPromise: Promise<unknown>;
      act(() => {
        mutationPromise = result.current.startAssessment();
      });

      // Check isPending state
      await waitFor(() => {
        expect(result.current.isCreating).toBe(true);
      });

      // Resolve the RPC
      act(() => {
        resolveRpc!({ data: "assessment-123", error: null });
      });

      // Wait for mutation to complete
      await act(async () => {
        await mutationPromise;
      });

      await waitFor(() => {
        expect(result.current.isCreating).toBe(false);
      });
    });
  });
});

describe("scoreToDbFormat", () => {
  it("should convert LongevityScore to DB format", () => {
    const score: LongevityScore = {
      overall: 75,
      dimensions: [
        {
          dimension: "VIT" as Dimension,
          rawScore: 8,
          normalizedScore: 80,
          tagCount: 3,
          hasNegativeIndicators: false,
          operationalFlags: ["flag1"],
        },
      ],
      interpretation: "good",
      alertFlags: ["ENE" as Dimension],
      assessmentDate: new Date(),
      trendVsBaseline: 5,
    };

    const dbFormat = scoreToDbFormat(score);

    expect(dbFormat.overall).toBe(75);
    expect(dbFormat.interpretation).toBe("good");
    expect(dbFormat.alertFlags).toEqual(["ENE"]);
    expect(dbFormat.hasCriticalFlags).toBe(true);
    expect(dbFormat.dimensions).toHaveLength(1);
    expect(dbFormat.dimensions[0].dimension).toBe("VIT");
  });

  it("should set hasCriticalFlags to false when no alerts", () => {
    const score: LongevityScore = {
      overall: 85,
      dimensions: [],
      interpretation: "excellent",
      alertFlags: [],
      assessmentDate: new Date(),
    };

    const dbFormat = scoreToDbFormat(score);

    expect(dbFormat.hasCriticalFlags).toBe(false);
  });
});

describe("dbToScoreFormat", () => {
  it("should convert DB record to LongevityScore", () => {
    const record = {
      id: "assessment-123",
      assessment_type: "onboarding",
      status: "completed" as const,
      overall_score: 72,
      interpretation: "good",
      trend_vs_baseline: 5,
      alert_flags: ["VIT"],
      has_critical_flags: false,
      completed_at: "2024-12-20T10:00:00Z",
      dimensions: [
        {
          dimension: "VIT" as Dimension,
          rawScore: 7,
          normalizedScore: 70,
          tagCount: 2,
          hasNegativeIndicators: false,
          operationalFlags: [],
        },
      ],
    };

    const score = dbToScoreFormat(record);

    expect(score.overall).toBe(72);
    expect(score.interpretation).toBe("good");
    expect(score.trendVsBaseline).toBe(5);
    expect(score.alertFlags).toEqual(["VIT"]);
    expect(score.assessmentDate).toBeInstanceOf(Date);
    expect(score.dimensions).toHaveLength(1);
  });

  it("should handle null values with defaults", () => {
    const record = {
      id: "assessment-456",
      assessment_type: "periodic",
      status: "completed" as const,
      overall_score: null,
      interpretation: null,
      trend_vs_baseline: null,
      alert_flags: [],
      has_critical_flags: false,
      completed_at: null,
      dimensions: [],
    };

    const score = dbToScoreFormat(record);

    expect(score.overall).toBe(0);
    expect(score.interpretation).toBe("average");
    expect(score.trendVsBaseline).toBeUndefined();
  });
});
