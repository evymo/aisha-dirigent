import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { toast } from "sonner";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { usePermissions } from "@/hooks/usePermissions";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import i18n from "@/i18n";
import { z } from "zod";

const t = (key: string) => i18n.t(key);

// ============================================================================
// Zod Schemas
// ============================================================================

/** Schema for leaderboard reward configuration (admin). */
export const leaderboardRewardConfigSchema = z.object({
  bonus_token_type: z.string(),
  bonus_tokens: z.number(),
  created_at: z.string(),
  id: z.string(),
  is_active: z.boolean(),
  period_type: z.string(),
  product_name: z.string().nullable(),
  rank_from: z.number(),
  rank_to: z.number(),
  updated_at: z.string(),
  voucher_product_id: z.string().nullable(),
});

// ============================================================================
// Types
// ============================================================================

/** Leaderboard reward config with joined product name. */
export type LeaderboardRewardConfig = z.infer<typeof leaderboardRewardConfigSchema>;

/** Input for creating/updating a leaderboard reward config. */
export interface UpsertLeaderboardRewardConfigInput {
  /** Existing config ID for update, undefined for insert */
  p_id?: string;
  /** Type of leaderboard period ('weekly', 'monthly', 'quarterly') */
  p_period_type?: string;
  /** Start rank (inclusive) */
  p_rank_from?: number;
  /** End rank (inclusive) */
  p_rank_to?: number;
  /** Number of bonus tokens to award */
  p_bonus_tokens?: number;
  /** Token type for bonus ('aisha') */
  p_bonus_token_type?: string;
  /** Product ID for voucher reward (null = tokens only) */
  p_voucher_product_id?: string;
  /** Whether this config is active */
  p_is_active?: boolean;
}

// ============================================================================
// Query Keys
// ============================================================================

const LEADERBOARD_REWARDS_KEY = "leaderboard-reward-configs" as const;

// ============================================================================
// Hooks
// ============================================================================

/**
 * Admin hook to list all leaderboard reward configurations.
 *
 * @returns Query result containing reward configs with product names.
 */
export function useLeaderboardRewardConfigs() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");
  const { guardAdminRead } = useAdminGuard();

  return useQuery({
    queryKey: [LEADERBOARD_REWARDS_KEY],
    queryFn: guardAdminRead("get_leaderboard_reward_configs_admin", async () => {
      const { data, error } = await aisha.rpc("get_leaderboard_reward_configs_admin");
      if (error) throw new Error(error.message);
      return parseRpcArray(leaderboardRewardConfigSchema, data, "get_leaderboard_reward_configs_admin");
    }),
    enabled: isAdmin,
    staleTime: 60_000,
  });
}

/**
 * Admin mutation to create or update a leaderboard reward config.
 * Pass p_id for update, omit for insert.
 *
 * @returns Mutation object for upserting leaderboard reward config.
 */
export function useUpsertLeaderboardRewardConfig() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "upsert_leaderboard_reward_config_admin",
      async (input: UpsertLeaderboardRewardConfigInput) => {
        const { data, error } = await aisha.rpc("upsert_leaderboard_reward_config_admin", {
          p_bonus_token_type: input.p_bonus_token_type,
          p_bonus_tokens: input.p_bonus_tokens,
          p_id: input.p_id,
          p_is_active: input.p_is_active,
          p_period_type: input.p_period_type,
          p_rank_from: input.p_rank_from,
          p_rank_to: input.p_rank_to,
          p_voucher_product_id: input.p_voucher_product_id,
        });
        if (error) throw new Error(error.message);
        return data as string;
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LEADERBOARD_REWARDS_KEY] });
      toast.success(t("admin.leaderboardRewards.success.saved"));
    },
    onError: () => {
      toast.error(t("admin.leaderboardRewards.errors.saveFailed"));
    },
  });
}

/**
 * Admin mutation to trigger award distribution for a leaderboard period.
 * Awards tokens and vouchers to ranked participants according to config.
 *
 * @returns Mutation object for distributing leaderboard rewards.
 */
export function useAwardLeaderboardRewards() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "award_leaderboard_rewards",
      async ({ periodId }: { periodId: string }) => {
        const { data, error } = await aisha.rpc("award_leaderboard_rewards", {
          p_period_id: periodId,
        });
        if (error) throw new Error(error.message);
        return data;
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LEADERBOARD_REWARDS_KEY] });
      toast.success(t("admin.leaderboardRewards.success.awarded"));
    },
    onError: () => {
      toast.error(t("admin.leaderboardRewards.errors.awardFailed"));
    },
  });
}
