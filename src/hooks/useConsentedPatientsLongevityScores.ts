/**
 * useConsentedUsersLongevityScores
 * Hook for partners to view Longevity Scores of users with consent
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";

/** Single user's Longevity Score summary for partner view */
export interface UserLongevityScore {
  user_id: string;
  display_name: string;
  overall_score: number;
  trend: "up" | "down" | "neutral";
  trend_percentage: number;
  domains: Record<string, number>;
  assessed_at: string;
  assessment_count: number;
}

/**
 * Fetches Longevity Score summaries for all consented users
 *
 * @param limit - Maximum number of users to fetch (default: 50)
 * @returns Query result with array of UserLongevityScore
 *
 * @example
 * const { data: scores, isLoading } = useConsentedUsersLongevityScores();
 */
export function useConsentedUsersLongevityScores(limit = 50) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["consented-users-longevity-scores", user?.id, limit],
    queryFn: async () => {
      const { data, error } = await aisha.rpc(
        "get_consented_users_longevity_scores",
        { p_limit: limit }
      );

      if (error) throw new Error(error.message);

      // Parse and validate the response
      if (!data || !Array.isArray(data)) {
        return [] as UserLongevityScore[];
      }

      return data.map((row: Record<string, unknown>): UserLongevityScore => ({
        user_id: String(row.user_id ?? ""),
        display_name: String(row.display_name ?? "Unknown"),
        overall_score: Number(row.overall_score ?? 0),
        trend: (row.trend === "up" || row.trend === "down") ? row.trend : "neutral",
        trend_percentage: Number(row.trend_percentage ?? 0),
        domains: (row.domains && typeof row.domains === "object") 
          ? row.domains as Record<string, number>
          : {},
        assessed_at: String(row.assessed_at ?? ""),
        assessment_count: Number(row.assessment_count ?? 0),
      }));
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Calculate aggregate statistics for all consented users' scores
 */
export function useConsentedUsersScoreStats() {
  const { data: scores, isLoading, error } = useConsentedUsersLongevityScores();

  const stats = scores && scores.length > 0 ? {
    avgScore: scores.reduce((sum, s) => sum + s.overall_score, 0) / scores.length,
    minScore: Math.min(...scores.map(s => s.overall_score)),
    maxScore: Math.max(...scores.map(s => s.overall_score)),
    totalUsers: scores.length,
    improving: scores.filter(s => s.trend === "up").length,
    declining: scores.filter(s => s.trend === "down").length,
    stable: scores.filter(s => s.trend === "neutral").length,
  } : null;

  return { stats, isLoading, error };
}
