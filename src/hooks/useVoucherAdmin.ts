import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { toast } from "sonner";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { usePermissions } from "@/hooks/usePermissions";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import i18n from "@/i18n";
import { z } from "zod";

const t = (key: string) => i18n.t(key);

// ============================================================================
// Zod Schemas
// ============================================================================

/** Schema for admin voucher list item. */
export const adminVoucherSchema = z.object({
  code: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  id: z.string(),
  metadata: z.unknown().nullable(),
  points_cost: z.number(),
  product_id: z.string(),
  product_name: z.string(),
  status: z.string(),
  updated_at: z.string(),
  used_at: z.string().nullable(),
  user_email: z.string(),
  user_id: z.string(),
});

/** Schema for voucher analytics aggregate. */
export const voucherAnalyticsSchema = z.object({
  active_count: z.number(),
  avg_points_cost: z.number(),
  conversion_rate: z.number(),
  expired_count: z.number(),
  total_issued: z.number(),
  total_points_spent: z.number(),
  used_count: z.number(),
});

/** Schema for manual voucher creation response. */
export const manualVoucherResultSchema = z.object({
  code: z.string(),
  id: z.string(),
});

// ============================================================================
// Types
// ============================================================================

/** Admin voucher list item with user and product info. */
export type AdminVoucher = z.infer<typeof adminVoucherSchema>;

/** Aggregated voucher analytics. */
export type VoucherAnalytics = z.infer<typeof voucherAnalyticsSchema>;

/** Result of manual voucher creation. */
export type ManualVoucherResult = z.infer<typeof manualVoucherResultSchema>;

/** Input for creating a manual voucher. */
export interface CreateManualVoucherInput {
  /** Product to create voucher for */
  p_product_id: string;
  /** Reason for manual creation (promo, compensation, etc.) */
  p_reason?: string;
  /** Target user ID (optional — allows gifting to specific user) */
  p_user_id?: string;
}

// ============================================================================
// Query Keys
// ============================================================================

const ADMIN_VOUCHERS_KEY = "admin-vouchers" as const;
const VOUCHER_ANALYTICS_KEY = "voucher-analytics" as const;

// ============================================================================
// Hooks
// ============================================================================

/**
 * Admin hook to list all vouchers with filtering and pagination.
 *
 * @param status - Optional filter by voucher status ('active', 'used', 'expired')
 * @param limit - Number of vouchers to return (default 50)
 * @param offset - Pagination offset (default 0)
 * @returns Query result containing admin voucher list.
 */
export function useVouchersAdmin(
  status?: string,
  limit = 50,
  offset = 0
) {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");
  const { guardAdminRead } = useAdminGuard();

  return useQuery({
    queryKey: [ADMIN_VOUCHERS_KEY, status, limit, offset],
    queryFn: guardAdminRead("get_vouchers_admin", async () => {
      const { data, error } = await aisha.rpc("get_vouchers_admin", {
        p_limit: limit,
        p_offset: offset,
        p_status: status,
      });
      if (error) throw new Error(error.message);
      return parseRpcArray(adminVoucherSchema, data, "get_vouchers_admin");
    }),
    enabled: isAdmin,
    staleTime: 30_000,
  });
}

/**
 * Admin hook to get aggregated voucher analytics.
 *
 * @returns Query result containing voucher analytics.
 */
export function useVoucherAnalytics() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");
  const { guardAdminRead } = useAdminGuard();

  return useQuery({
    queryKey: [VOUCHER_ANALYTICS_KEY],
    queryFn: guardAdminRead("get_voucher_analytics_admin", async () => {
      const { data, error } = await aisha.rpc("get_voucher_analytics_admin");
      if (error) throw new Error(error.message);
      // RPC returns array with single row
      const rows = parseRpcArray(voucherAnalyticsSchema, data, "get_voucher_analytics_admin");
      return rows[0] ?? null;
    }),
    enabled: isAdmin,
    staleTime: 60_000,
  });
}

/**
 * Admin mutation to create a manual (promo/compensation) voucher.
 * Automatically invalidates voucher list and analytics caches on success.
 *
 * @returns Mutation object for creating a manual voucher.
 */
export function useCreateManualVoucher() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "create_manual_voucher_admin",
      async (input: CreateManualVoucherInput) => {
        const { data, error } = await aisha.rpc("create_manual_voucher_admin", {
          p_product_id: input.p_product_id,
          p_reason: input.p_reason,
          p_user_id: input.p_user_id,
        });
        if (error) throw new Error(error.message);
        // RPC RETURNS TABLE → PostgREST returns array with single row
        const rows = parseRpcArray(manualVoucherResultSchema, data, "create_manual_voucher_admin");
        if (rows.length === 0) throw new Error("create_manual_voucher_admin returned empty result");
        return rows[0];
      }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_VOUCHERS_KEY] });
      queryClient.invalidateQueries({ queryKey: [VOUCHER_ANALYTICS_KEY] });
      toast.success(t("admin.vouchers.success.created"));
    },
    onError: () => {
      toast.error(t("admin.vouchers.errors.createFailed"));
    },
  });
}
