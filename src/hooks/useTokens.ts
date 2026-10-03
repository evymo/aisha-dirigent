import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "./useSession";
import { useMembership } from "./useMembership";
import { useIsMountedRef } from "./useIsMountedRef";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { usePermissions } from "@/hooks/usePermissions";
import { parseRpcResponse, processRewardResultSchema } from "@/lib/validation/rpcSchemas";
import { z } from "zod";

export type TokenType = "governance" | "impact" | "data" | "aisha";
export type TransactionType = "earned" | "spent" | "transferred" | "bonus" | "expired" | "reward" | "transfer" | "burn" | "lock" | "unlock";

// Zod schema for token transactions
const tokenTransactionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  token_type: z.string(),
  amount: z.number(),
  transaction_type: z.string(),
  description: z.string().nullable(),
  reference_id: z.string().nullable(),
  reference_type: z.string().nullable(),
  balance_after: z.number(),
  created_at: z.string(),
});

/**
 * Represents a single token transaction.
 */
export interface TokenTransaction {
  /** Unique identifier for the transaction */
  id: string;
  /** ID of the user involved in the transaction */
  user_id: string;
  /** Type of token (governance, impact, data) */
  token_type: string;
  /** Amount of tokens involved */
  amount: number;
  /** Type of transaction (earned, spent, etc.) */
  transaction_type: string;
  /** Optional description of the transaction */
  description: string | null;
  /** ID of the related entity (e.g., study registration ID) */
  reference_id: string | null;
  /** Type of the related entity */
  reference_type: string | null;
  /** Token balance after the transaction */
  balance_after: number;
  /** Timestamp of the transaction */
  created_at: string;
}

/**
 * Represents the current balance of different token types.
 */
export interface TokenBalance {
  /** Balance of AISHA utility tokens */
  aisha: number;
  /** Balance of governance tokens */
  governance: number;
  /** Balance of impact tokens */
  impact: number;
  /** Balance of data tokens */
  data: number;
}

/**
 * Hook for managing user tokens and transactions.
 * Provides access to token balances, transaction history, and methods to log new transactions.
 * 
 * @returns Object containing token data and operations.
 */
export function useTokens() {
  const { user } = useSession();
  const { membership } = useMembership();
  const [transactions, setTransactions] = useState<TokenTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useIsMountedRef();

  const balance: TokenBalance = {
    aisha: membership?.tokens_aisha || 0,
    governance: membership?.tokens_governance || 0,
    impact: membership?.tokens_impact || 0,
    data: membership?.tokens_data || 0,
  };

  const totalTokens = balance.aisha + balance.governance + balance.impact + balance.data;

  const fetchTransactions = useCallback(async () => {
    if (!user) {
      if (isMountedRef.current) {
        setTransactions([]);
        setLoading(false);
      }
      return;
    }

    try {
      const { data, error } = await aisha.rpc("get_my_token_transactions", {
        p_limit: 50,
      });

      if (error) throw new Error(error.message);
      
      // Validate array of transactions
      const parsed = z.array(tokenTransactionSchema).safeParse(data ?? []);
      if (isMountedRef.current) {
        setTransactions(parsed.success ? parsed.data : []);
      }
    } catch (err) {
      safeError("Error fetching token transactions", err);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user, isMountedRef]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const logTransaction = async (
    tokenType: TokenType,
    amount: number,
    transactionType: TransactionType,
    description?: string,
    referenceId?: string,
    _referenceType?: string
  ) => {
    if (!user) return { error: new Error("Not authenticated") };

    const actualAmount = transactionType === "spent" || transactionType === "transferred" || transactionType === "expired" 
      ? -Math.abs(amount) 
      : Math.abs(amount);

    // Use RPC instead of direct table access
    // RPC-only pattern - using correct signature from types
    const { error } = await aisha.rpc("create_token_transaction", {
      p_amount: actualAmount,
      p_description: description ?? "",
      p_reference_id: referenceId ?? undefined
,
      p_token_type: tokenType,
      p_transaction_type: transactionType
    });

    if (!error) {
      fetchTransactions();
    }

    return { error };
  };

  return {
    balance,
    totalTokens,
    transactions,
    loading,
    logTransaction,
    refetch: fetchTransactions,
  };
}

// Admin hooks for managing all transactions
// Zod schema for admin token transactions (validates RPC response)
const adminTokenTransactionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  token_type: z.string(),
  transaction_type: z.string(),
  amount: z.number(),
  balance_after: z.number(),
  reference_type: z.string().nullable(),
  reference_id: z.string().nullable(),
  description: z.string().nullable(),
  created_at: z.string(),
});

const adminTokenTransactionsArraySchema = z.array(adminTokenTransactionSchema);

export function useAllTokenTransactions(filters?: {
  tokenType?: string;
  transactionType?: string;
  userId?: string;
  referenceType?: string;
  limit?: number;
}) {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["all-token-transactions", filters],
    queryFn: async (): Promise<TokenTransaction[]> => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_all_token_transactions_admin", {
        p_limit: filters?.limit ?? 100,
        p_reference_type: filters?.referenceType
,
        p_token_type: filters?.tokenType,
        p_transaction_type: filters?.transactionType,
        p_user_id: filters?.userId
    });

      if (error) {
        safeError("useAllTokenTransactions.rpc", error);
        throw new Error(error.message);
      }

      // Validate and parse the response
      const parsed = adminTokenTransactionsArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useAllTokenTransactions.validation", parsed.error);
        return [];
      }

      return parsed.data;
    },
    retry: 1,
    enabled: isAdmin,
  });
}

export function useAwardTokens() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("award_tokens", async ({
      userId,
      tokenType,
      amount,
      referenceType,
      referenceId,
      description,
    }: {
      userId: string;
      tokenType: string;
      amount: number;
      referenceType?: string;
      referenceId?: string;
      description?: string;
    }) => {
      // award_tokens is service_role-only since the 2026-07-15 IDOR fix — it was
      // GRANTed to `authenticated` with no DB-side authorization, so any logged-in
      // user could mint tokens via POST /rest/v1/rpc/award_tokens (guardAdminMutation
      // below is client-side and enforces nothing in the DB). This admin path now goes
      // through the audited wrapper, which checks is_admin_or_staff() IN THE DATABASE.
      // See docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md.
      const { data, error } = await aisha.rpc("award_tokens_admin_audited", {
        p_amount: amount,
        p_description: description ?? undefined
,
        p_reference_id: referenceId ?? undefined,
        p_reference_type: referenceType ?? undefined,
        p_token_type: tokenType,
        p_user_id: userId
    });

      if (error) throw new Error(error.message);
      return data;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-token-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["memberships"] });
    },
  });
}

export interface ProcessRewardResult {
  success: boolean;
  transaction_id?: string;
  previous_balance?: number;
  new_balance?: number;
  amount_awarded?: number;
  reason?: string;
}

export function useProcessReward() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async ({
      actionType,
      referenceId,
    }: {
      actionType: string;
      referenceId?: string;
    }): Promise<ProcessRewardResult | null> => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await aisha.rpc("process_token_reward", {
        p_action_type: actionType,
        p_reference_id: referenceId ?? undefined
,
        p_user_id: user.id
    });

      if (error) throw new Error(error.message);
      if (!data) return null;
      
      // Validate with schema
      return parseRpcResponse(processRewardResultSchema, data, "process_token_reward");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-token-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["memberships"] });
    },
  });
}

export function useCanReceiveReward(actionType: string, tokenType: string) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["can-receive-reward", user?.id, actionType, tokenType],
    queryFn: async () => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await aisha.rpc("can_receive_reward", {
        p_action_type: actionType,
        p_token_type: tokenType
,
        p_user_id: user.id
    });

      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!user && !!actionType && !!tokenType,
  });
}
