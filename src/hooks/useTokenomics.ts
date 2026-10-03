import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { toast } from "sonner";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { usePermissions } from "@/hooks/usePermissions";
import i18n from "@/i18n";
import {
  parseRpcArray,
  parseRpcResponse,
  tokenConfigSchema,
  tokenRewardRuleSchema,
  tokenBurnSchema,
  tokenAllocationSchema,
  tokenomicsOverviewSchema,
} from "@/lib/validation/rpcSchemas";

// Helper to get translated string directly (works outside React components)
const t = (key: string) => i18n.t(key);

/**
 * Configuration for a specific token type.
 */
export interface TokenConfig {
  /** Unique identifier for the configuration */
  id: string;
  /** Type of token (governance, impact, data) */
  token_type: string;
  /** Display name of the token */
  name: string;
  /** Symbol of the token (e.g., GOV, IMP) */
  symbol: string;
  /** Description of the token's purpose */
  description: string | null;
  /** Total supply of tokens */
  total_supply: number;
  /** Currently circulating supply */
  circulating_supply: number;
  /** Supply currently locked */
  locked_supply: number;
  /** Supply that has been burned */
  burned_supply: number;
  /** Daily emission rate (if applicable) */
  emission_rate_daily: number | null;
  /** Whether this token type is active */
  is_active: boolean;
  /** Timestamp of creation */
  created_at: string;
  /** Timestamp of last update */
  updated_at: string;
}

/**
 * Rule defining how tokens are rewarded for specific actions.
 */
export interface TokenRewardRule {
  /** Unique identifier for the rule */
  id: string;
  /** System identifier for the action (e.g., 'daily_checkin') */
  action_type: string;
  /** Translation key for the action name */
  action_name_key: string;
  /** Translation key for the description */
  description_key: string | null;
  /** Type of token rewarded */
  token_type: string;
  /** Base amount of tokens rewarded */
  base_amount: number;
  /** Multiplier applied to the base amount */
  multiplier: number;
  /** Minimum reward amount */
  min_amount: number | null;
  /** Maximum reward amount */
  max_amount: number | null;
  /** Daily limit for this action */
  daily_limit: number | null;
  /** Weekly limit for this action */
  weekly_limit: number | null;
  /** Monthly limit for this action */
  monthly_limit: number | null;
  /** Cooldown period in hours */
  cooldown_hours: number | null;
  /** Whether membership is required for this reward */
  requires_membership: boolean;
  /** Specific membership tier required */
  membership_tier_required: string | null;
  /** Whether the rule is active */
  is_active: boolean;
  /** Sort order for display */
  sort_order: number;
  /** Timestamp of creation */
  created_at: string;
  /** Timestamp of last update */
  updated_at: string;
}

/**
 * Represents a lock on a user's tokens.
 */
export interface TokenLock {
  /** Unique identifier for the lock */
  id: string;
  /** ID of the user whose tokens are locked */
  user_id: string;
  /** Type of token locked */
  token_type: string;
  /** Amount of tokens locked */
  amount: number;
  /** Reason for the lock */
  lock_reason: string | null;
  /** Start date of the lock */
  lock_start: string;
  /** End date of the lock */
  lock_end: string;
  /** Schedule for unlocking (e.g., 'cliff', 'linear') */
  unlock_schedule: string;
  /** Amount currently unlocked */
  unlocked_amount: number;
  /** Whether the lock is active */
  is_active: boolean;
  /** Admin notes */
  notes: string | null;
  /** ID of the user who created the lock */
  created_by?: string | null;
  /** Timestamp of creation */
  created_at: string;
  /** Timestamp of last update */
  updated_at?: string;
  /** Timestamp when locked */
  locked_at?: string;
  /** Condition for unlocking */
  unlock_condition?: string;
  /** Profile of the user */
  profile?: {
    display_name: string | null;
    email: string | null;
  };
}

/**
 * Record of burned tokens.
 */
export interface TokenBurn {
  /** Unique identifier for the burn record */
  id: string;
  /** Type of token burned */
  token_type: string;
  /** Amount of tokens burned */
  amount: number;
  /** Reason for burning */
  burn_reason: string;
  /** ID of the user whose tokens were burned (optional) */
  source_user_id: string | null;
  /** Description of the burn event */
  description: string | null;
  /** ID of the user who initiated the burn */
  burned_by: string;
  /** Timestamp of creation */
  created_at: string;
}

/**
 * Allocation of tokens for a specific purpose.
 */
export interface TokenAllocation {
  /** Unique identifier for the allocation */
  id: string;
  /** Name of the allocation */
  allocation_name: string;
  /** Type of allocation */
  allocation_type: string;
  /** Type of token allocated */
  token_type: string;
  /** Total amount allocated */
  total_amount: number;
  /** Amount already distributed */
  distributed_amount: number;
  /** Start of vesting period */
  vesting_start: string | null;
  /** End of vesting period */
  vesting_end: string | null;
  vesting_schedule: string;
  cliff_months: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Hook to fetch all token configurations.
 *
 * @returns Query result containing list of token configurations.
 */
export function useTokenConfigs() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["token-configs"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_token_configs_admin");
      if (error) throw new Error(error.message);
      return parseRpcArray(tokenConfigSchema, data, "get_token_configs_admin");
    },
    enabled: isAdmin,
  });
}

/**
 * Hook to update a token configuration.
 *
 * @returns Mutation object for updating token configuration.
 */
export function useUpdateTokenConfig() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_token_config_admin", async ({ id, updates }: { id: string; updates: Partial<TokenConfig> }) => {
      // Canonical signature uses p_token_type as identifier
      const { data, error } = await aisha.rpc("update_token_config_admin", {
        p_description: updates.description ?? undefined,
        p_emission_rate_daily: updates.emission_rate_daily ?? undefined,
        p_is_active: updates.is_active ?? undefined
,
        p_name: updates.name ?? undefined,
        p_symbol: updates.symbol ?? undefined,
        p_token_type: updates.token_type ?? id,
        p_total_supply: updates.total_supply ?? undefined
    });
      if (error) throw new Error(error.message);
      return parseRpcResponse(tokenConfigSchema, data, "update_token_config_admin");
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["token-configs"] });
      toast.success(t("admin.tokenomics.success.configUpdated"));
    },
    onError: () => {
      toast.error(t("admin.tokenomics.errors.configUpdateFailed"));
    },
  });
}

/**
 * Hook to fetch all token reward rules.
 *
 * @returns Query result containing list of reward rules.
 */
export function useTokenRewardRules() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["token-reward-rules"],
    queryFn: async (): Promise<TokenRewardRule[]> => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_token_reward_rules_admin");
      if (error) throw new Error(error.message);
      return parseRpcArray(tokenRewardRuleSchema, data, "get_token_reward_rules_admin") as TokenRewardRule[];
    },
    enabled: isAdmin,
  });
}

/**
 * Hook to update a reward rule.
 *
 * @returns Mutation object for updating a reward rule.
 */
export function useUpdateRewardRule() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_token_reward_rule_admin", async ({ id, updates }: { id: string; updates: Partial<TokenRewardRule> }) => {
      // Canonical signature uses p_id as identifier
      const { data, error } = await aisha.rpc("update_token_reward_rule_admin", {
        p_conditions: undefined
,
        p_description: updates.description_key ?? undefined,
        p_id: id,
        p_is_active: updates.is_active ?? undefined,
        p_reward_amount: updates.base_amount ?? undefined,
        p_sort_order: updates.sort_order ?? undefined
    });
      if (error) throw new Error(error.message);
      return parseRpcResponse(tokenRewardRuleSchema, data, "update_token_reward_rule_admin");
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["token-reward-rules"] });
      toast.success(t("admin.tokenomics.success.ruleUpdated"));
    },
    onError: () => {
      toast.error(t("admin.tokenomics.errors.ruleUpdateFailed"));
    },
  });
}

/**
 * Hook to create a new reward rule.
 *
 * @returns Mutation object for creating a reward rule.
 */
export function useCreateRewardRule() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_token_reward_rule_admin", async (rule: Partial<TokenRewardRule>) => {
      const { data, error } = await aisha.rpc("create_token_reward_rule_admin", {
        p_action_key: rule.action_type ?? "",
        p_description: rule.description_key ?? "",
        p_is_active: rule.is_active ?? true,
        p_reward_amount: rule.base_amount ?? 0,
        p_sort_order: rule.sort_order ?? 0
,
        p_token_type: rule.token_type ?? "aisha"
    });
      if (error) throw new Error(error.message);
      return parseRpcResponse(tokenRewardRuleSchema, data, "create_token_reward_rule_admin");
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["token-reward-rules"] });
      toast.success(t("admin.tokenomics.success.ruleCreated"));
    },
    onError: () => {
      toast.error(t("admin.tokenomics.errors.ruleCreateFailed"));
    },
  });
}

/**
 * Hook to fetch all token locks.
 *
 * @returns Query result containing list of token locks.
 */
export function useTokenLocks() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["token-locks"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_token_locks_admin");
      if (error) throw new Error(error.message);

      // Map RPC response to TokenLock interface
      return (data || []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r.id as string,
          user_id: r.user_id as string,
          token_type: r.token_type as string,
          amount: r.amount as number,
          lock_reason: (r.lock_reason as string) ?? null,
          lock_start: (r.lock_start as string) ?? "",
          lock_end: (r.lock_end as string) ?? "",
          unlock_schedule: (r.unlock_schedule as string) ?? "",
          unlocked_amount: (r.unlocked_amount as number) ?? 0,
          is_active: (r.is_active as boolean) ?? true,
          notes: (r.notes as string) ?? null,
          unlock_condition: (r.unlock_condition as string) ?? undefined,
          created_at: (r.created_at as string) ?? "",
          profile: {
            display_name: (r.profile_display_name as string) ?? null,
            email: (r.profile_email as string) ?? null,
          },
        } as TokenLock;
      });
    },
    enabled: isAdmin,
  });
}

/**
 * Hook to create a new token lock.
 *
 * @returns Mutation object for creating a token lock.
 */
export function useCreateTokenLock() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_token_lock_admin", async (lock: Partial<TokenLock>) => {
      if (!lock.user_id || !lock.token_type || lock.amount === undefined || !lock.lock_end) {
        throw new Error("Missing required fields: user_id, token_type, amount, lock_end");
      }
      const { data, error } = await aisha.rpc("create_token_lock_admin", {
        p_amount: lock.amount,
        p_lock_end: lock.lock_end,
        p_lock_reason: lock.lock_reason ?? undefined,
        p_lock_start: lock.lock_start ?? undefined,
        p_notes: lock.notes ?? undefined
,
        p_token_type: lock.token_type,
        p_unlock_schedule: lock.unlock_schedule ?? undefined,
        p_user_id: lock.user_id
    });
      if (error) throw new Error(error.message);

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;

      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        user_id: r.user_id as string,
        token_type: r.token_type as string,
        amount: r.amount as number,
        lock_reason: (r.lock_reason as string) ?? null,
        lock_start: (r.lock_start as string) ?? "",
        lock_end: (r.lock_end as string) ?? "",
        unlock_schedule: (r.unlock_schedule as string) ?? "",
        unlocked_amount: (r.unlocked_amount as number) ?? 0,
        is_active: (r.is_active as boolean) ?? true,
        notes: (r.notes as string) ?? null,
        created_at: (r.created_at as string) ?? "",
        profile: {
          display_name: (r.profile_display_name as string) ?? null,
          email: (r.profile_email as string) ?? null,
        },
      } as TokenLock;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["token-locks"] });
      toast.success(t("admin.tokenomics.success.lockCreated"));
    },
    onError: () => {
      toast.error(t("admin.tokenomics.errors.lockCreateFailed"));
    },
  });
}

/**
 * Hook to update a token lock.
 *
 * @returns Mutation object for updating a token lock.
 */
export function useUpdateTokenLock() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_token_lock_admin", async ({ id, updates }: { id: string; updates: Partial<TokenLock> }) => {
      const { data, error } = await aisha.rpc("update_token_lock_admin", {
        p_amount: updates.amount,
        p_is_active: updates.is_active,
        p_lock_end: updates.lock_end,
        p_lock_id: id,
        p_lock_reason: updates.lock_reason ?? undefined,
        p_notes: updates.notes ?? undefined
,
        p_unlock_schedule: updates.unlock_schedule,
        p_unlocked_amount: updates.unlocked_amount
    });
      if (error) throw new Error(error.message);

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;

      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        user_id: r.user_id as string,
        token_type: r.token_type as string,
        amount: r.amount as number,
        lock_reason: (r.lock_reason as string) ?? null,
        lock_start: (r.lock_start as string) ?? "",
        lock_end: (r.lock_end as string) ?? "",
        unlock_schedule: (r.unlock_schedule as string) ?? "",
        unlocked_amount: (r.unlocked_amount as number) ?? 0,
        is_active: (r.is_active as boolean) ?? true,
        notes: (r.notes as string) ?? null,
        created_at: (r.created_at as string) ?? "",
        profile: {
          display_name: (r.profile_display_name as string) ?? null,
          email: (r.profile_email as string) ?? null,
        },
      } as TokenLock;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["token-locks"] });
      toast.success(t("admin.tokenomics.success.lockUpdated"));
    },
    onError: () => {
      toast.error(t("admin.tokenomics.errors.lockUpdateFailed"));
    },
  });
}

/**
 * Hook to fetch all token burns.
 *
 * @returns Query result containing list of token burns.
 */
export function useTokenBurns() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["token-burns"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_token_burns_admin");
      if (error) throw new Error(error.message);
      return parseRpcArray(tokenBurnSchema, data, "get_token_burns_admin");
    },
    enabled: isAdmin,
  });
}

/**
 * Hook to create a new token burn record.
 *
 * @returns Mutation object for creating a token burn.
 */
export function useCreateTokenBurn() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_token_burn_admin", async (burn: Partial<TokenBurn>) => {
      const { data, error } = await aisha.rpc("create_token_burn_admin", {
        p_amount: burn.amount ?? 0,
        p_description: burn.description ?? undefined
,
        p_reason: burn.burn_reason ?? "",
        p_source_user_id: burn.source_user_id ?? undefined,
        p_token_type: burn.token_type ?? "aisha"
    });
      if (error) throw new Error(error.message);
      return parseRpcResponse(tokenBurnSchema, data, "create_token_burn_admin");
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["token-burns"] });
      queryClient.invalidateQueries({ queryKey: ["token-configs"] });
      toast.success(t("admin.tokenomics.success.burnRecorded"));
    },
    onError: () => {
      toast.error(t("admin.tokenomics.errors.burnFailed"));
    },
  });
}

/**
 * Hook to fetch all token allocations.
 *
 * @returns Query result containing list of token allocations.
 */
export function useTokenAllocations() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["token-allocations"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_token_allocations_admin");
      if (error) throw new Error(error.message);
      return parseRpcArray(tokenAllocationSchema, data, "get_token_allocations_admin");
    },
    enabled: isAdmin,
  });
}

/**
 * Hook to create a new token allocation.
 *
 * @returns Mutation object for creating a token allocation.
 */
export function useCreateTokenAllocation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_token_allocation_admin", async (allocation: Partial<TokenAllocation>) => {
      const { data, error } = await aisha.rpc("create_token_allocation_admin", {
        p_allocation_amount: allocation.total_amount ?? 0,
        p_name: allocation.allocation_name ?? "",
        p_purpose: allocation.allocation_type ?? "team",
        p_token_type: allocation.token_type ?? "aisha",
        p_vesting_end: allocation.vesting_end ?? undefined
,
        p_vesting_start: allocation.vesting_start ?? undefined
    });
      if (error) throw new Error(error.message);
      return parseRpcResponse(tokenAllocationSchema, data, "create_token_allocation_admin");
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["token-allocations"] });
      toast.success(t("admin.tokenomics.success.allocationCreated"));
    },
    onError: () => {
      toast.error(t("admin.tokenomics.errors.allocationCreateFailed"));
    },
  });
}

/**
 * Hook to update a token allocation.
 *
 * @returns Mutation object for updating a token allocation.
 */
export function useUpdateTokenAllocation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_token_allocation_admin", async ({ id, updates }: { id: string; updates: Partial<TokenAllocation> }) => {
      // Canonical signature uses p_id as identifier
      const { data, error } = await aisha.rpc("update_token_allocation_admin", {
        p_allocation_amount: updates.total_amount,
        p_id: id,
        p_is_active: updates.is_active
,
        p_name: updates.allocation_name ?? undefined,
        p_purpose: updates.notes ?? undefined,
        p_vesting_end: updates.vesting_end ?? undefined,
        p_vesting_start: updates.vesting_start ?? undefined
    });
      if (error) throw new Error(error.message);
      return parseRpcResponse(tokenAllocationSchema, data, "update_token_allocation_admin");
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["token-allocations"] });
      toast.success(t("admin.tokenomics.success.allocationUpdated"));
    },
    onError: () => {
      toast.error(t("admin.tokenomics.errors.allocationUpdateFailed"));
    },
  });
}

/**
 * Hook to fetch aggregated tokenomics statistics.
 *
 * @returns Query result containing aggregated tokenomics statistics.
 */
export function useTokenomicsStats() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["tokenomics-stats"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_tokenomics_overview");
      
      if (error) throw new Error(error.message);
      if (!data) return [];

      const typedData = parseRpcResponse(tokenomicsOverviewSchema, data, "get_tokenomics_overview");

      const configs = typedData.token_configs || [];
      const transactions = typedData.transaction_summary || [];
      const locks = typedData.active_locks || [];
      const burns = typedData.burn_summary || [];

      // Calculate stats per token type
      const stats = configs.map((config) => {
        const tokenType = config.token_type as string;
        const tokenTransactions = transactions.filter((t) => t.token_type === tokenType);
        const tokenLocks = locks.filter((l) => l.token_type === tokenType);
        const tokenBurns = burns.filter((b) => b.token_type === tokenType);

        const totalEarned = tokenTransactions
          .filter((t) => t.transaction_type === 'earned' || t.transaction_type === 'bonus')
          .reduce((sum, t) => sum + Number(t.amount), 0);
        const totalSpent = tokenTransactions
          .filter((t) => t.transaction_type === 'spent')
          .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
        const totalLocked = tokenLocks.reduce((sum, l) => sum + Number(l.amount), 0);
        const totalBurned = tokenBurns.reduce((sum, b) => sum + Number(b.amount), 0);

        return {
          ...config,
          totalEarned,
          totalSpent,
          totalLocked,
          totalBurned,
          netCirculating: totalEarned - totalSpent - totalLocked - totalBurned,
        };
      });

      return stats;
    },
    enabled: isAdmin,
  });
}
