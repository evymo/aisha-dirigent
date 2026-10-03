/**
 * Claim Cosmos Reward Hook — mobile mutation for claiming on-chain token rewards.
 * Deducts token balance and creates an outbox record for Cosmos chain sync.
 * Only governance (ugov) and aisha (uash) denominations are supported.
 * Requires cosmos_address to be set on profile (via useRegisterCosmosAddress).
 * Calls: claim_cosmos_reward(p_amount, p_denom)
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";

/** Parameters for claiming a Cosmos reward. */
export interface ClaimCosmosRewardParams {
  /** Amount of tokens to claim (positive integer). */
  amount: number;
  /** Token denomination: 'uash' (aisha) or 'ugov' (governance). Defaults to 'uash'. */
  denom?: "uash" | "ugov";
}

const claimParamsSchema = z.object({
  amount: z.number().int().positive(),
  denom: z.enum(["uash", "ugov"]).default("uash"),
});

/**
 * Mutation hook for claiming on-chain token rewards.
 * Validates params, deducts balance, and creates blockchain outbox record.
 * Returns the reward claim UUID on success.
 * Invalidates token, membership, and reward claims queries.
 */
export function useClaimCosmosReward() {
  const queryClient = useQueryClient();

  return useMutation<string, Error, ClaimCosmosRewardParams>({
    mutationFn: async (params) => {
      const validated = claimParamsSchema.parse(params);

      const { data, error } = await api.rpc("claim_cosmos_reward", {
        p_amount: validated.amount,
        p_denom: validated.denom,
      });

      if (error) throw error;
      return z.string().uuid().parse(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["token-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["membership"] });
      queryClient.invalidateQueries({ queryKey: ["gamification-stats"] });
      queryClient.invalidateQueries({ queryKey: ["reward-claims"] });
    },
    onError: (err) => {
      safeError("cosmos.reward.claim.failed", err);
    },
  });
}
