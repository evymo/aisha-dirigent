import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

// =============================================
// TYPES
// =============================================

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  avatarUrl: string | null;
  totalTokens: number;
  governanceTokens: number;
  impactTokens: number;
  dataTokens: number;
  isCurrentUser: boolean;
}

export interface MyLeaderboardPosition {
  globalRank: number;
  leaderboardRank: number | null;
  totalTokens: number;
  governanceTokens: number;
  impactTokens: number;
  dataTokens: number;
  isInLeaderboard: boolean;
  totalParticipants: number;
}

export interface ProfileVisibility {
  nickname: string | null;
  isPublicProfile: boolean;
  showInLeaderboard: boolean;
  displayNamePublic: string;
}

// =============================================
// SCHEMAS
// =============================================

const leaderboardEntrySchema = z.object({
  rank: z.number(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  total_tokens: z.number(),
  governance_tokens: z.number(),
  impact_tokens: z.number(),
  data_tokens: z.number(),
  is_current_user: z.boolean(),
});

const myPositionSchema = z.object({
  global_rank: z.number(),
  leaderboard_rank: z.number().nullable(),
  total_tokens: z.number(),
  governance_tokens: z.number(),
  impact_tokens: z.number(),
  data_tokens: z.number(),
  is_in_leaderboard: z.boolean(),
  total_participants: z.number(),
});

const visibilitySchema = z.object({
  nickname: z.string().nullable(),
  is_public_profile: z.boolean(),
  show_in_leaderboard: z.boolean(),
  display_name_public: z.string(),
});

// =============================================
// HOOKS
// =============================================

export type TokenTypeFilter = "all" | "governance" | "impact" | "data";

/**
 * Fetch token leaderboard with optional token type filter.
 */
export function useLeaderboard(tokenType: TokenTypeFilter = "all", limit = 20) {
  return useQuery({
    queryKey: ["leaderboard", tokenType, limit],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const { data, error } = await aisha.rpc("get_token_leaderboard", {
        p_limit: limit,
        p_token_type: tokenType === "all" ? undefined : tokenType,
      });

      if (error) {
        safeError("useLeaderboard.fetch", error);
        throw new Error(error.message);
      }

      const parsed = z.array(leaderboardEntrySchema).safeParse(data);
      if (!parsed.success) {
        safeError("useLeaderboard.parse", parsed.error);
        return [];
      }

      return parsed.data.map((entry) => ({
        rank: entry.rank,
        displayName: entry.display_name,
        avatarUrl: entry.avatar_url,
        totalTokens: entry.total_tokens,
        governanceTokens: entry.governance_tokens,
        impactTokens: entry.impact_tokens,
        dataTokens: entry.data_tokens,
        isCurrentUser: entry.is_current_user,
      }));
    },
    staleTime: 60_000, // 1 minute
    gcTime: 300_000, // 5 minutes
  });
}

/**
 * Fetch current user's leaderboard position.
 */
export function useMyLeaderboardPosition(tokenType: TokenTypeFilter = "all") {
  const { user } = useSession();

  return useQuery({
    queryKey: ["my-leaderboard-position", user?.id, tokenType],
    queryFn: async (): Promise<MyLeaderboardPosition | null> => {
      const { data, error } = await aisha.rpc("get_my_leaderboard_position", {
        p_token_type: tokenType === "all" ? undefined : tokenType,
      });

      if (error) {
        safeError("useMyLeaderboardPosition.fetch", error);
        throw new Error(error.message);
      }

      if (!data) return null;

      const parsed = myPositionSchema.safeParse(data);
      if (!parsed.success) {
        safeError("useMyLeaderboardPosition.parse", parsed.error);
        return null;
      }

      return {
        globalRank: parsed.data.global_rank,
        leaderboardRank: parsed.data.leaderboard_rank,
        totalTokens: parsed.data.total_tokens,
        governanceTokens: parsed.data.governance_tokens,
        impactTokens: parsed.data.impact_tokens,
        dataTokens: parsed.data.data_tokens,
        isInLeaderboard: parsed.data.is_in_leaderboard,
        totalParticipants: parsed.data.total_participants,
      };
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}

/**
 * Fetch current user's profile visibility settings.
 */
export function useProfileVisibility() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["profile-visibility", user?.id],
    queryFn: async (): Promise<ProfileVisibility | null> => {
      const { data, error } = await aisha.rpc("get_my_profile_visibility");

      if (error) {
        safeError("useProfileVisibility.fetch", error);
        throw new Error(error.message);
      }

      // RPC returns array, take first
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;

      const parsed = visibilitySchema.safeParse(row);
      if (!parsed.success) {
        safeError("useProfileVisibility.parse", parsed.error);
        return null;
      }

      return {
        nickname: parsed.data.nickname,
        isPublicProfile: parsed.data.is_public_profile,
        showInLeaderboard: parsed.data.show_in_leaderboard,
        displayNamePublic: parsed.data.display_name_public,
      };
    },
    enabled: !!user,
  });
}

/**
 * Mutation to update profile visibility settings.
 */
export function useUpdateProfileVisibility() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async ({
      isPublicProfile,
      showInLeaderboard,
      nickname,
    }: {
      isPublicProfile?: boolean;
      showInLeaderboard?: boolean;
      nickname?: string;
    }) => {
      const { data, error } = await aisha.rpc("update_my_profile_visibility", {
        p_is_public_profile: isPublicProfile,
        p_nickname: nickname
,
        p_show_in_leaderboard: showInLeaderboard
    });

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-visibility", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["my-leaderboard-position"] });
    },
  });
}
