import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import { z } from "zod";

// ============================================================================
// Zod Schemas
// ============================================================================

/** Schema for a product available in the reward shop. */
export const rewardShopProductSchema = z.object({
  category: z.string().nullable(),
  description: z.string().nullable(),
  id: z.string(),
  image_url: z.string().nullable(),
  name: z.string(),
  price: z.number(),
  sku: z.string().nullable(),
  token_price: z.number(),
  token_price_type: z.string(),
});

/** Schema for wallet balance returned from get_my_wallet_balance. */
export const walletBalanceSchema = z.object({
  aisha_tokens: z.number(),
  data_tokens: z.number(),
  governance_tokens: z.number(),
  impact_tokens: z.number(),
  updated_at: z.string().nullable(),
  user_id: z.string(),
});

// ============================================================================
// Types
// ============================================================================

/** A product available for purchase with PLATFORM tokens. */
export type RewardShopProduct = z.infer<typeof rewardShopProductSchema>;

/** User wallet balance from the DB wallet table. */
export type WalletBalance = z.infer<typeof walletBalanceSchema>;

// ============================================================================
// Query Keys
// ============================================================================

const REWARD_SHOP_KEY = "reward-shop-products" as const;
const WALLET_BALANCE_KEY = "wallet-balance" as const;

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch products available in the reward shop.
 * Only returns products with a token_price > 0 that are active.
 *
 * @returns Query result containing list of reward shop products.
 */
export function useRewardShopProducts() {
  const { user } = useSession();

  return useQuery({
    queryKey: [REWARD_SHOP_KEY],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_reward_shop_products");
      if (error) throw new Error(error.message);
      return parseRpcArray(rewardShopProductSchema, data, "get_reward_shop_products");
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}

/**
 * Hook to fetch the current user's wallet balance (all token types).
 * Uses the get_my_wallet_balance RPC which includes PLATFORM.
 *
 * @returns Query result containing user wallet balance.
 */
export function useWalletBalance() {
  const { user } = useSession();

  return useQuery({
    queryKey: [WALLET_BALANCE_KEY, user?.id],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_my_wallet_balance");
      if (error) throw new Error(error.message);
      // RPC returns array with single row
      const rows = parseRpcArray(walletBalanceSchema, data, "get_my_wallet_balance");
      return rows[0] ?? null;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
}
