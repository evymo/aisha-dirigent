import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const invoiceItemSchema = z.object({
  id: z.string(),
  price_at_purchase: z.number(),
  product_id: z.string().nullable().optional(),
  product_name: z.string().nullable().optional(),
  product_sku: z.string().nullable().optional(),
  quantity: z.number(),
});

const orderInvoiceDataSchema = z.object({
  billing_address: z.record(z.unknown()).nullable().optional(),
  created_at: z.string(),
  currency: z.string().nullable().optional(),
  id: z.string(),
  invoice_generated_at: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  order_items: z.array(invoiceItemSchema),
  payment_method: z.string().nullable().optional(),
  shipping: z.number().nullable().optional(),
  shipping_address: z.record(z.unknown()).nullable().optional(),
  shipping_method: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  tax: z.number().nullable().optional(),
  total: z.number(),
  user_email: z.string().nullable().optional(),
  user_name: z.string().nullable().optional(),
  variable_symbol: z.string().nullable().optional(),
});

/**
 * Order data needed for invoice PDF rendering.
 */
export type OrderInvoiceData = z.infer<typeof orderInvoiceDataSchema>;

/**
 * Single invoice item (order line).
 */
export type InvoiceItem = z.infer<typeof invoiceItemSchema>;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch full order data for invoice rendering.
 * Works for both order owner (member) and admin.
 *
 * @param orderId - UUID of the order to fetch invoice data for
 * @param enabled - Whether to enable the query (default: true when orderId is set)
 * @returns Query with order invoice data
 */
export function useOrderInvoiceData(
  orderId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: ["order-invoice-data", orderId],
    queryFn: async (): Promise<OrderInvoiceData | null> => {
      if (!orderId) return null;

      const { data, error } = await aisha.rpc("get_order_invoice_data", {
        p_order_id: orderId,
      });

      if (error) {
        safeError("orderInvoiceData.fetchFailed", error);
        throw new Error(error.message);
      }

      if (!data) return null;

      const raw = typeof data === "string" ? JSON.parse(data) : data;
      const parsed = orderInvoiceDataSchema.safeParse(raw);

      if (!parsed.success) {
        safeError("orderInvoiceData.parseFailed", {
          issues: parsed.error.issues.map((i) => i.path.join(".")),
        });
        return null;
      }

      return parsed.data;
    },
    enabled: enabled && !!orderId,
    staleTime: 60 * 1000,
  });
}
