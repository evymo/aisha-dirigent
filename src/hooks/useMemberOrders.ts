import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

const orderItemSchema = z.object({
  id: z.string(),
  quantity: z.number(),
  price_at_purchase: z.number(),
  product: z.object({
    name: z.string(),
    slug: z.string().optional().default(""),
  }).optional().nullable(),
});

const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  total: z.number(),
  subtotal: z.number().optional(),
  shipping: z.number().optional(),
  currency: z.string().optional().default(BASE_CURRENCY_FALLBACK),
  created_at: z.string(),
  delivered_at: z.string().nullable(),
  bank_transfer_amount: z.number().nullable().optional(),
  bank_transfer_bic: z.string().nullable().optional(),
  bank_transfer_due_date: z.string().nullable().optional(),
  bank_transfer_iban: z.string().nullable().optional(),
  invoice_generated_at: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  payment_status: z.string().nullable().optional(),
  variable_symbol: z.string().nullable().optional(),
  order_items: z.array(orderItemSchema).optional(),
});

const ordersArraySchema = z.array(orderSchema);

export type MemberOrder = z.infer<typeof orderSchema>;
export type MemberOrderItem = z.infer<typeof orderItemSchema>;

export function useMyOrders(enabled = true) {
  return useQuery({
    queryKey: ["my-orders"],
    queryFn: async (): Promise<MemberOrder[]> => {
      const { data, error } = await aisha.rpc("get_my_orders_audited");

      if (error) {
        safeError("member.orders.fetchFailed", error);
        throw new Error(error.message);
      }

      const rawData = (data || []) as Array<Record<string, unknown>>;
      const normalized = rawData.map((order) => {
        const orderItems = Array.isArray(order.order_items)
          ? order.order_items
          : Array.isArray(order.items)
            ? order.items
            : [];
        return {
          ...order,
          order_items: orderItems,
          currency: typeof order.currency === "string" ? order.currency : BASE_CURRENCY_FALLBACK,
        };
      });

      const parsed = ordersArraySchema.safeParse(normalized);
      if (!parsed.success) {
        safeError("member.orders.parseError", parsed.error);
        return normalized as MemberOrder[];
      }

      return parsed.data;
    },
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}
