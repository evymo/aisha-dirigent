import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { leaderboardEntrySchema, myLeaderboardPositionSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { LeaderboardEntry, MyLeaderboardPosition } from "@/types/schemas";

function parseLeaderboard(data: unknown): LeaderboardEntry[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<LeaderboardEntry[]>((acc, item) => {
    const result = leaderboardEntrySchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

export function useLeaderboard(tokenType?: string) {
  return useQuery({
    queryKey: ["leaderboard", tokenType],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_token_leaderboard", {
        p_limit: 20,
        ...(tokenType ? { p_token_type: tokenType } : {}),
      });
      if (error) {
        safeError("useLeaderboard.fetch", error);
        throw error;
      }
      return parseLeaderboard(data);
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useMyLeaderboardPosition() {
  return useQuery<MyLeaderboardPosition>({
    queryKey: ["my-leaderboard-position"],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_leaderboard_position");
      if (error) {
        safeError("useMyLeaderboardPosition.fetch", error);
        throw error;
      }
      return myLeaderboardPositionSchema.parse(data);
    },
    staleTime: 2 * 60 * 1000,
  });
}
