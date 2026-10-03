import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

// Schema for order row from RPC
const orderRowSchema = z.object({
  billing_address: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  currency: z.string().optional().default(BASE_CURRENCY_FALLBACK),
  delivered_at: z.string().nullable(),
  id: z.string().uuid(),
  invoice_generated_at: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  order_items: z.array(z.object({
    id: z.string().uuid(),
    price_at_purchase: z.number(),
    product_id: z.string().uuid().optional(),
    quantity: z.number(),
  })),
  payment_method: z.string().nullable().optional(),
  payment_status: z.string().nullable().optional(),
  shipping: z.number().nullable().optional(),
  shipping_address: z.record(z.unknown()).nullable(),
  status: z.string(),
  stripe_payment_intent_id: z.string().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  total: z.number(),
  updated_at: z.string().optional(),
  user_email: z.string().nullable().optional(),
  user_id: z.string().uuid(),
  user_name: z.string().nullable().optional(),
  variable_symbol: z.string().nullable().optional(),
});

export type OrderRow = z.infer<typeof orderRowSchema>;

export interface Order {
  billing_address: Record<string, unknown> | null;
  created_at: string;
  currency?: string;
  delivered_at: string | null;
  id: string;
  invoice_generated_at?: string | null;
  invoice_number?: string | null;
  order_items: Array<{
    id: string;
    price_at_purchase: number;
    product_id?: string;
    quantity: number;
  }>;
  payment_method?: string | null;
  payment_status?: string | null;
  shipping?: number | null;
  shipping_address: Record<string, unknown> | null;
  status: string;
  stripe_payment_intent_id?: string | null;
  subtotal?: number | null;
  total: number;
  updated_at?: string;
  user_email?: string | null;
  user_id: string;
  user_name?: string | null;
  variable_symbol?: string | null;
}

/**
 * Hook for fetching orders with admin privileges
 */
export function useOrdersAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-orders"],
    queryFn: async (): Promise<Order[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_orders_admin_with_items", {
        p_limit: 500,
        p_status: undefined,
      });

      if (error) {
        safeError("admin.orders.fetchFailed", error);
        throw new Error(error.message);
      }

      const parseResult = z.array(orderRowSchema).safeParse(data);
      if (!parseResult.success) {
        safeError("admin.orders.parseError", parseResult.error);
        return [];
      }

      return parseResult.data.map((row) => ({
        ...row,
        order_items: row.order_items ?? [],
      }));
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for updating order status
 */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_order_status_admin", async ({ orderId, status }: { orderId: string; status: string }) => {
      const { error } = await aisha.rpc("update_order_status_admin", {
        p_order_id: orderId,
        p_status: status,
      });

      if (error) throw new Error(error.message);
      return { orderId, status };
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (error) => {
      safeError("admin.orders.updateFailed", error);
    },
  });
}
