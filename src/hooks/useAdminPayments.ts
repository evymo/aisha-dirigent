import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { parseArrayResponse, orderWithPaymentArraySchema } from "@/lib/schemas/adminSchemas";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";

export interface Payment {
  id: string;
  order_id: string;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
  order: {
    id: string;
    status: string;
    user_id: string;
    shipping_address: Record<string, unknown> | null;
  } | null;
  profile: {
    display_name: string | null;
    email: string | null;
  } | null;
}

/**
 * Hook for fetching payments (orders with payment info) for admin
 */
export function useAdminPayments() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-payments"],
    queryFn: async (): Promise<Payment[]> => {
      if (!isAdmin || !user) return [];
      const { data: ordersData, error } = await aisha.rpc("get_orders_admin", {
        p_limit: 500
,
        p_status: undefined
    });

      if (error) {
        safeError("adminPayments.fetch.failed", error);
        throw new Error(error.message);
      }

      const validatedOrders = parseArrayResponse(orderWithPaymentArraySchema, ordersData, "ordersWithPayment");

      return validatedOrders.map((order) => ({
        id: order.id,
        order_id: order.id,
        stripe_payment_intent_id: order.stripe_payment_intent_id,
        stripe_session_id: null,
        amount: order.total,
        currency: order.currency ?? BASE_CURRENCY_FALLBACK,
        status: order.status,
        created_at: order.created_at,
        updated_at: order.updated_at,
        order: {
          id: order.id,
          status: order.status,
          user_id: order.user_id,
          shipping_address: order.shipping_address,
        },
        profile: {
          display_name: order.user_name ?? null,
          email: order.user_email ?? null,
        },
      }));
    },
    staleTime: 30 * 1000, // 30 seconds
    enabled: isAdmin && !!user,
  });
}

export interface RefundParams {
  paymentIntentId: string;
  amount?: number; // In cents
}

/**
 * Process a refund via the dedicated stripe-refund service route
 * (svc-stripe POST /refund → stripe.refunds.create). The refund was previously
 * (incorrectly) routed through the signature-verified `stripe-webhook` function.
 */
export async function processRefund(params: RefundParams): Promise<void> {
  const { error } = await aisha.functions.invoke("stripe-refund", {
    body: {
      paymentIntentId: params.paymentIntentId,
      amount: params.amount,
    },
  });

  if (error) {
    safeError("adminPayments.refund.failed", error);
    throw new Error("Refund failed");
  }
}

/**
 * Hook that returns a refetch function for payments
 */
export function useRefetchPayments() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: ["admin-payments"] });
  };
}
