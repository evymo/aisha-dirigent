import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

/**
 * Bank transfer details for an order
 */
const bankTransferDetailsSchema = z.object({
  bank_transfer_amount: z.number().nullable().optional(),
  bank_transfer_bic: z.string().nullable().optional(),
  bank_transfer_due_date: z.string().nullable().optional(),
  bank_transfer_iban: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  id: z.string(),
  payment_method: z.string().nullable().optional(),
  payment_status: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  total: z.number(),
  variable_symbol: z.string().nullable().optional(),
});

export type BankTransferDetails = z.infer<typeof bankTransferDetailsSchema>;

/**
 * Hook to fetch bank transfer details for a specific order.
 * Uses edge_bank_transactions RPC with get_order_bank_transfer action.
 *
 * @param orderId - The UUID of the order
 * @returns Query result with bank transfer details
 */
export function useOrderBankTransfer(orderId: string | undefined) {
  return useQuery({
    queryKey: ["order-bank-transfer", orderId],
    queryFn: async (): Promise<BankTransferDetails | null> => {
      if (!orderId) return null;

      const { data, error } = await aisha.rpc("edge_bank_transactions", {
        p_action: "get_order_bank_transfer",
        p_payload: { order_id: orderId },
      });

      if (error) {
        safeError("useOrderBankTransfer.fetchFailed", error);
        throw new Error(error.message);
      }

      if (!data) return null;

      // edge_bank_transactions returns data directly
      const raw = typeof data === "string" ? JSON.parse(data) : data;
      const parsed = bankTransferDetailsSchema.safeParse(raw);

      if (!parsed.success) {
        safeError("useOrderBankTransfer.parseFailed", {
          issues: parsed.error.issues.map((i) => i.path.join(".")),
        });
        return null;
      }

      return parsed.data;
    },
    enabled: !!orderId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}
