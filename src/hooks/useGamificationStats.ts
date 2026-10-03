/**
 * useGamificationStats Hook (Web)
 *
 * Provides gamification stats (total points, streak, rank)
 * from token_allocations — the reward system fed by
 * questionnaires, reminders, and health check-ins.
 *
 * Uses RPC `get_my_gamification_stats` — no direct table queries.
 *
 * @example
 * const { stats, isLoading } = useGamificationStats();
 * // stats.total_points — cumulative reward points
 * // stats.current_streak — current daily streak
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";

/** Gamification stats from token_allocations reward system. */
export interface GamificationStats {
  best_streak: number;
  current_streak: number;
  monthly_points: number;
  monthly_rank?: number;
  total_check_ins: number;
  total_completions: number;
  total_points: number;
  weekly_points: number;
  weekly_rank?: number;
}

/** Query key shared with invalidation across hooks. */
export const GAMIFICATION_STATS_QUERY_KEY = ["gamification-stats"] as const;

/**
 * Hook for fetching user's gamification stats (reward points, streak, rank).
 *
 * Data comes from `token_allocations` + `token_transactions`
 * (separate from membership governance/impact/data tokens).
 *
 * @returns Object with stats, loading state, error, and refetch function
 */
export function useGamificationStats() {
  const { user } = useSession();

  const {
    data: stats,
    isLoading,
    error,
    refetch,
  } = useQuery<GamificationStats | null>({
    queryKey: [...GAMIFICATION_STATS_QUERY_KEY],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_my_gamification_stats");
      if (error) throw new Error(error.message);
      if (!data) return null;

      const raw = data as Record<string, unknown>;
      return {
        best_streak: Number(raw.best_streak ?? 0),
        current_streak: Number(raw.current_streak ?? 0),
        monthly_points: Number(raw.monthly_points ?? 0),
        monthly_rank: raw.monthly_rank != null ? Number(raw.monthly_rank) : undefined,
        total_check_ins: Number(raw.total_check_ins ?? 0),
        total_completions: Number(raw.total_completions ?? 0),
        total_points: Number(raw.total_points ?? 0),
        weekly_points: Number(raw.weekly_points ?? 0),
        weekly_rank: raw.weekly_rank != null ? Number(raw.weekly_rank) : undefined,
      };
    },
    enabled: !!user,
    staleTime: 1000 * 60, // 1 minute
  });

  return { error, isLoading, refetch, stats };
}
