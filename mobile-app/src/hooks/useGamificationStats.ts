import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { gamificationStatsSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { GamificationStats } from "@/types/schemas";

export function useGamificationStats(userId: string | undefined) {
  return useQuery<GamificationStats>({
    queryKey: ["gamification-stats", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_gamification_stats");
      if (error) {
        safeError("useGamificationStats.fetch", error);
        throw error;
      }
      return gamificationStatsSchema.parse(data);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
