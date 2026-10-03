/**
 * Reward Claims Hook — fetches authenticated user's on-chain reward claims.
 * Allows users to track claim status (pending/fulfilled/failed).
 * Calls: get_my_reward_claims(p_limit)
 */
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/config/api";
import { rewardClaimSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";

import type { RewardClaim } from "@/types/schemas";

const rewardClaimArraySchema = z.array(rewardClaimSchema);

/**
 * Query hook returning the authenticated user's reward claims.
 * Refreshes every 30s while claims are pending.
 */
export function useRewardClaims(userId: string | undefined) {
  return useQuery<RewardClaim[]>({
    queryKey: ["reward-claims", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_reward_claims", {
        p_limit: 20,
      });

      if (error) {
        safeError("useRewardClaims.fetch", error);
        throw error;
      }

      return rewardClaimArraySchema.parse(data);
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}
