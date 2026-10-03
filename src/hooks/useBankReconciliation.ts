import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const bankTransactionSchema = z.object({
  amount: z.number(),
  created_at: z.string(),
  currency: z.string(),
  fio_transaction_id: z.string().nullable().optional(),
  id: z.string(),
  match_notes: z.string().nullable().optional(),
  match_status: z.string(),
  match_type: z.string().nullable().optional(),
  matched_order_id: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  sender_account: z.string().nullable().optional(),
  sender_name: z.string().nullable().optional(),
  transaction_date: z.string().nullable().optional(),
  variable_symbol: z.string().nullable().optional(),
});

export type BankTransaction = z.infer<typeof bankTransactionSchema>;

const awaitingOrderSchema = z.object({
  bank_transfer_amount: z.number().nullable().optional(),
  bank_transfer_due_date: z.string().nullable().optional(),
  created_at: z.string(),
  currency: z.string(),
  id: z.string(),
  total: z.number(),
  variable_symbol: z.string().nullable().optional(),
});

export type AwaitingOrder = z.infer<typeof awaitingOrderSchema>;

const syncResultSchema = z.object({
  auto_matched: z.number().optional(),
  duplicates: z.number().optional(),
  inserted: z.number().optional(),
  ok: z.boolean(),
  reason: z.string().optional(),
  total: z.number().optional(),
});

export type FioSyncResult = z.infer<typeof syncResultSchema>;

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseBankTransactions(raw: unknown): BankTransaction[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const rows = obj.rows;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => {
      const parsed = bankTransactionSchema.safeParse(r);
      return parsed.success ? parsed.data : null;
    })
    .filter((r): r is BankTransaction => r !== null);
}

function parseAwaitingOrders(raw: unknown): AwaitingOrder[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const rows = obj.rows;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => {
      const parsed = awaitingOrderSchema.safeParse(r);
      return parsed.success ? parsed.data : null;
    })
    .filter((r): r is AwaitingOrder => r !== null);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch unmatched bank transactions for reconciliation view.
 *
 * @returns Query with unmatched bank transactions.
 */
export function useUnmatchedBankTransactions() {
  return useQuery({
    queryKey: ["admin-bank-transactions", "unmatched"],
    queryFn: async (): Promise<BankTransaction[]> => {
      const { data, error } = await aisha.rpc("edge_bank_transactions", {
        p_action: "get_unmatched",
        p_payload: {},
      });

      if (error) {
        safeError("bankReconciliation.fetchUnmatched", error);
        throw new Error(error.message);
      }

      return parseBankTransactions(data);
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch all bank transactions for admin view.
 *
 * @returns Query with all bank transactions.
 */
export function useAllBankTransactions() {
  return useQuery({
    queryKey: ["admin-bank-transactions", "all"],
    queryFn: async (): Promise<BankTransaction[]> => {
      const { data, error } = await aisha.rpc("edge_bank_transactions", {
        p_action: "get_all",
        p_payload: {},
      });

      if (error) {
        safeError("bankReconciliation.fetchAll", error);
        throw new Error(error.message);
      }

      return parseBankTransactions(data);
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch orders awaiting bank transfer payment for manual matching.
 *
 * @returns Query with awaiting_transfer orders.
 */
export function useAwaitingTransferOrders() {
  return useQuery({
    queryKey: ["admin-bank-transactions", "awaiting-orders"],
    queryFn: async (): Promise<AwaitingOrder[]> => {
      const { data, error } = await aisha.rpc("edge_bank_transactions", {
        p_action: "get_awaiting_orders",
        p_payload: {},
      });

      if (error) {
        safeError("bankReconciliation.fetchAwaitingOrders", error);
        throw new Error(error.message);
      }

      return parseAwaitingOrders(data);
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Manually match a bank transaction to an order.
 *
 * @returns Mutation for matching a transaction to an order.
 */
export function useMatchTransactionToOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      notes?: string;
      order_id: string;
      transaction_id: string;
    }): Promise<void> => {
      const { data, error } = await aisha.rpc("edge_bank_transactions", {
        p_action: "match_to_order",
        p_payload: {
          notes: params.notes,
          order_id: params.order_id,
          transaction_id: params.transaction_id,
        },
      });

      if (error) {
        safeError("bankReconciliation.matchToOrder", error);
        throw new Error(error.message);
      }

      const result = data as { ok?: boolean } | null;
      if (!result?.ok) {
        throw new Error("Match operation failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
  });
}

/**
 * Dismiss (ignore) a bank transaction.
 *
 * @returns Mutation for dismissing a transaction.
 */
export function useDismissTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      notes?: string;
      transaction_id: string;
    }): Promise<void> => {
      const { data, error } = await aisha.rpc("edge_bank_transactions", {
        p_action: "dismiss_transaction",
        p_payload: {
          notes: params.notes,
          transaction_id: params.transaction_id,
        },
      });

      if (error) {
        safeError("bankReconciliation.dismiss", error);
        throw new Error(error.message);
      }

      const result = data as { ok?: boolean } | null;
      if (!result?.ok) {
        throw new Error("Dismiss operation failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-bank-transactions"] });
    },
  });
}

/**
 * Trigger manual Fio bank sync via edge function.
 *
 * @returns Mutation for syncing Fio bank transactions.
 */
export function useFioBankSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params?: {
      from_date?: string;
      to_date?: string;
    }): Promise<FioSyncResult> => {
      const { data, error } = await aisha.functions.invoke(
        "fio-bank-sync",
        {
          body: {
            action: "sync",
            from_date: params?.from_date,
            to_date: params?.to_date,
          },
        },
      );

      if (error) {
        safeError("bankReconciliation.fioSync", error);
        throw new Error(error.message);
      }

      const parsed = syncResultSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error("Invalid sync response");
      }

      return parsed.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-bank-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
  });
}

/**
 * Check Fio bank sync configuration status.
 *
 * @returns Query with configuration status.
 */
export function useFioBankSyncStatus() {
  return useQuery({
    queryKey: ["fio-bank-sync-status"],
    queryFn: async () => {
      const { data, error } = await aisha.functions.invoke(
        "fio-bank-sync",
        {
          body: { action: "status" },
        },
      );

      if (error) {
        safeError("bankReconciliation.syncStatus", error);
        return { configured: false, enabled: false, check_interval_minutes: 30 };
      }

      return data as {
        check_interval_minutes: number;
        configured: boolean;
        enabled: boolean;
      };
    },
    staleTime: 60 * 1000,
  });
}
