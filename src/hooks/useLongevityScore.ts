/**
 * Longevity Score hooks for calculating and tracking CLS (Celkový Longevity Score).
 *
 * The Longevity Score is calculated from OS-SUBJECTIVE questionnaire responses,
 * measuring 9 health domains: Vitality, Energy, Sleep, Physical, Cognitive,
 * Emotional, Pain, Digestion, and Overall Health.
 *
 * @module hooks/useLongevityScore
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// ============================================================================
// Types
// ============================================================================

/**
 * Domain score for a single health dimension.
 */
export interface DomainScore {
  domain_code: string;
  domain_name_key: string;
  questions_answered: number;
  raw_score: number;
  max_possible: number;
  percentage: number | null;
}

/**
 * Complete Longevity Score result with trend analysis.
 */
export interface LongevityScoreResult {
  response_id: string;
  user_id: string;
  completed_at: string;
  cls_score: number | null;
  domain_scores: DomainScore[];
  trend_vs_baseline: number | null;
  trend_direction: "improving" | "stable" | "declining" | null;
}

/**
 * Historical entry for Longevity Score tracking.
 */
export interface LongevityScoreHistoryEntry {
  response_id: string;
  completed_at: string;
  cls_score: number | null;
  domain_scores: DomainScore[];
  trend_vs_previous: number | null;
  /** Direction of trend compared to previous entry */
  trend_direction?: "up" | "down" | "stable" | null;
  /** Percentage change compared to previous entry */
  trend_change_percent?: number | null;
}

/**
 * Responses for OS-SUBJECTIVE questionnaire.
 */
export type LongevityResponses = Record<string, number>;

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to get Longevity Score for a specific questionnaire response.
 *
 * @param responseId - UUID of the questionnaire response
 * @returns Query result with Longevity Score data
 *
 * @example
 * ```tsx
 * const { data: score, isLoading } = useLongevityScore(responseId);
 * if (score) {
 *   console.log(`CLS: ${score.cls_score}%`);
 * }
 * ```
 */
export function useLongevityScore(responseId: string | null | undefined) {
  return useQuery({
    queryKey: ["longevity-score", responseId],
    queryFn: async (): Promise<LongevityScoreResult | null> => {
      if (!responseId) return null;

      const { data, error } = await aisha.rpc("get_longevity_score_audited", {
        p_response_id: responseId,
      });

      if (error) throw new Error(error.message);
      
      if (!data) return null;

      // Parse domain_scores from JSONB
      const result = data as unknown as {
        response_id: string;
        user_id: string;
        completed_at: string;
        cls_score: number | null;
        domain_scores: DomainScore[] | string;
        trend_vs_baseline: number | null;
        trend_direction: string | null;
      };

      return {
        ...result,
        domain_scores: typeof result.domain_scores === "string" 
          ? JSON.parse(result.domain_scores) 
          : result.domain_scores,
        trend_direction: result.trend_direction as LongevityScoreResult["trend_direction"],
      };
    },
    enabled: !!responseId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to get Longevity Score history for the current user or a specific user.
 *
 * @param options - Configuration options
 * @returns Query result with score history
 *
 * @example
 * ```tsx
 * const { data: history } = useLongevityScoreHistory({ limit: 12 });
 * history?.forEach(entry => {
 *   console.log(`${entry.completed_at}: ${entry.cls_score}%`);
 * });
 * ```
 */
export function useLongevityScoreHistory(options?: {
  userId?: string;
  limit?: number;
}) {
  const { user } = useSession();
  const targetUserId = options?.userId ?? user?.id;

  return useQuery({
    queryKey: ["longevity-score-history", targetUserId, options?.limit],
    queryFn: async (): Promise<LongevityScoreHistoryEntry[]> => {
      const { data, error } = await aisha.rpc(
        "get_longevity_score_history_audited",
        {
          p_limit: options?.limit ?? 12,
        
          p_user_id: options?.userId ?? undefined,}
      );

      if (error) throw new Error(error.message);
      if (!data) return [];

      // Parse domain_scores from JSONB for each entry
      return (data as unknown[]).map((entry) => {
        const e = entry as {
          response_id: string;
          completed_at: string;
          cls_score: number | null;
          domain_scores: DomainScore[] | string;
          trend_vs_previous: number | null;
        };
        return {
          ...e,
          domain_scores: typeof e.domain_scores === "string"
            ? JSON.parse(e.domain_scores)
            : e.domain_scores,
        };
      });
    },
    enabled: !!targetUserId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to submit OS-SUBJECTIVE assessment and calculate Longevity Score.
 *
 * @returns Mutation for submitting assessment
 *
 * @example
 * ```tsx
 * const { mutateAsync: submitAssessment } = useSubmitLongevityAssessment();
 *
 * const handleSubmit = async (responses: LongevityResponses) => {
 *   const result = await submitAssessment({ responses });
 *   console.log(`Your CLS: ${result.cls_score}%`);
 * };
 * ```
 */
export function useSubmitLongevityAssessment() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      responses,
      studyRegistrationId,
    }: {
      responses: LongevityResponses;
      studyRegistrationId?: string;
    }): Promise<LongevityScoreResult> => {
      const { data, error } = await aisha.rpc(
        "submit_longevity_assessment_audited",
        {
          p_responses: responses,
          p_study_registration_id: studyRegistrationId ?? undefined,
        }
      );

      if (error) throw new Error(error.message);
      if (!data) throw new Error("No data returned");

      const result = data as unknown as {
        response_id: string;
        user_id: string;
        completed_at: string;
        cls_score: number | null;
        domain_scores: DomainScore[] | string;
        trend_vs_baseline: number | null;
        trend_direction: string | null;
      };

      return {
        ...result,
        domain_scores: typeof result.domain_scores === "string"
          ? JSON.parse(result.domain_scores)
          : result.domain_scores,
        trend_direction: result.trend_direction as LongevityScoreResult["trend_direction"],
      };
    },
    onSuccess: (data) => {
      // Invalidate history cache
      queryClient.invalidateQueries({ queryKey: ["longevity-score-history"] });
      
      // Show success toast with score
      toast.success(t("assessment.success"), {
        description: t("assessment.yourScore", {
          score: data.cls_score?.toFixed(0) ?? "N/A",
        }),
      });
    },
    onError: () => {
      toast.error(t("common.error"), {
        description: t("assessment.submitError"),
      });
    },
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the trend icon name for a given direction.
 * Returns a lucide-react icon name string.
 */
export function getTrendIconName(
  direction: LongevityScoreResult["trend_direction"]
): string {
  switch (direction) {
    case "improving":
      return "trending-up";
    case "declining":
      return "trending-down";
    case "stable":
      return "minus";
    default:
      return "";
  }
}

/**
 * Get the color class for a score percentage.
 */
export function getScoreColorClass(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-lime-600";
  if (score >= 40) return "text-yellow-600";
  if (score >= 20) return "text-orange-600";
  return "text-red-600";
}

/**
 * Get domain name in current locale.
 */
export function getDomainName(domain: DomainScore, locale: string, t?: (key: string) => string): string {
  if (t && domain.domain_name_key) {
    return t(domain.domain_name_key);
  }
  return domain.domain_name_key || domain.domain_code;
}

/**
 * Calculate overall improvement from history.
 */
export function calculateOverallImprovement(
  history: LongevityScoreHistoryEntry[]
): {
  hasImproved: boolean;
  totalChange: number;
  firstScore: number | null;
  lastScore: number | null;
} {
  if (history.length < 2) {
    return {
      hasImproved: false,
      totalChange: 0,
      firstScore: history[0]?.cls_score ?? null,
      lastScore: history[0]?.cls_score ?? null,
    };
  }

  // History is sorted DESC, so first = most recent, last = oldest
  const lastScore = history[0].cls_score;
  const firstScore = history[history.length - 1].cls_score;

  if (lastScore === null || firstScore === null) {
    return {
      hasImproved: false,
      totalChange: 0,
      firstScore,
      lastScore,
    };
  }

  const totalChange = lastScore - firstScore;

  return {
    hasImproved: totalChange > 0,
    totalChange,
    firstScore,
    lastScore,
  };
}

/**
 * Find domains that need attention (lowest scores).
 */
export function getDomainsNeedingAttention(
  domainScores: DomainScore[],
  threshold = 50
): DomainScore[] {
  return domainScores
    .filter((d) => d.percentage !== null && d.percentage < threshold)
    .sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0));
}

/**
 * Find domains with best performance.
 */
export function getStrongestDomains(
  domainScores: DomainScore[],
  threshold = 70
): DomainScore[] {
  return domainScores
    .filter((d) => d.percentage !== null && d.percentage >= threshold)
    .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0));
}
