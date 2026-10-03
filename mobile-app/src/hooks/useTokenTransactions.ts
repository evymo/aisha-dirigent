/**
 * Token Transactions Hook — fetches transaction history via RPC.
 * Uses tokenTransactionSchema for Zod validation.
 * Calls: get_my_token_transactions(p_limit)
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { tokenTransactionSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

import type { TokenTransaction } from "@/types/schemas";

const transactionArraySchema = z.array(tokenTransactionSchema);

/**
 * Fetches the authenticated user's token transactions via RPC.
 * Supports limit and optional client-side tokenType filter.
 */
export function useTokenTransactions(
  userId: string | undefined,
  options?: { limit?: number; tokenType?: string },
) {
  const limit = options?.limit ?? 50;
  const tokenType = options?.tokenType;

  return useQuery<TokenTransaction[]>({
    queryKey: ["token-transactions", userId, { limit, tokenType }],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_token_transactions", {
        p_limit: limit,
      });

      if (error) {
        safeError("useTokenTransactions.fetch", error);
        throw error;
      }

      const parsed = transactionArraySchema.parse(data);

      if (tokenType) {
        return parsed.filter((t) => t.token_type === tokenType);
      }

      return parsed;
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
