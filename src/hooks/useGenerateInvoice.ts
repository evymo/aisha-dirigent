import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useAdminGuard } from "@/hooks/useAdminGuard";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const generateInvoiceResultSchema = z.object({
  already_existed: z.boolean(),
  invoice_number: z.string(),
});

/**
 * Result of invoice generation RPC.
 */
export type GenerateInvoiceResult = z.infer<typeof generateInvoiceResultSchema>;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook for generating an invoice number for an order.
 * Calls `generate_invoice_for_order` RPC (admin-only, idempotent).
 *
 * @returns Mutation that returns the invoice number.
 */
export function useGenerateInvoice() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "generate_invoice_for_order",
      async ({
        orderId,
        prefix = "FAK",
      }: {
        orderId: string;
        prefix?: string;
      }): Promise<GenerateInvoiceResult> => {
        const { data, error } = await aisha.rpc(
          "generate_invoice_for_order",
          {
            p_order_id: orderId,
            p_prefix: prefix,
          }
        );

        if (error) {
          safeError("generateInvoice.failed", error);
          throw new Error(error.message);
        }

        const parsed = generateInvoiceResultSchema.safeParse(data);
        if (!parsed.success) {
          safeError("generateInvoice.parseFailed", {
            issues: parsed.error.issues.map((i) => i.path.join(".")),
          });
          throw new Error("Invalid response from generate_invoice_for_order");
        }

        return parsed.data;
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (error) => {
      safeError("generateInvoice.mutationError", error);
    },
  });
}
