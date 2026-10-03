import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { parseArrayResponse } from "@/lib/schemas/adminSchemas";
import type { Enums } from "@/integrations/db/types";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { useCommerceBaseCurrency, BASE_CURRENCY_FALLBACK } from "@/hooks/useCurrency";

// Local schema for RPC response row - matches get_subscription_packages_admin return type
const adminSubscriptionPackageRowSchema = z.object({
  created_at: z.string(),
  // RPC resolves currency to commerce_base_currency() at read, so it is never null.
  currency: z.string(),
  description: z.string().nullable(),
  governance_tokens: z.coerce.number().int(),
  id: z.string().uuid(),
  impact_tokens: z.coerce.number().int(),
  is_active: z.boolean(),
  is_recurring: z.boolean().optional().default(false),
  name: z.string(),
  period: z.string(),
  price: z.coerce.number().optional(),
  slug: z.string(),
  sort_order: z.coerce.number().int(),
  stripe_price_id: z.string().nullable(),
  tier: z.string(),
  updated_at: z.string(),
  // Localization columns
  name_key: z.string().nullable().optional(),
  description_key: z.string().nullable().optional(),
  base_locale: z.string().nullable().optional(),
});

export type SubscriptionPackageAdmin = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  period: Enums<"subscription_period">;
  tier: Enums<"membership_tier">;
  /** Price denominated in `currency` (the instance base currency). */
  price: number;
  currency: string;
  governance_tokens: number;
  impact_tokens: number;
  is_active: boolean;
  is_recurring: boolean;
  sort_order: number;
  stripe_price_id: string | null;
  // Localization fields
  name_key: string | null;
  description_key: string | null;
  base_locale: string | null;
};

export function useSubscriptionPackagesAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-subscription-packages"],
    queryFn: async (): Promise<SubscriptionPackageAdmin[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_subscription_packages_admin");
      if (error) {
        safeError("admin.subscriptionPackages.fetchFailed", error);
        throw new Error(error.message);
      }

      const rows = parseArrayResponse(
        z.array(adminSubscriptionPackageRowSchema),
        data,
        "get_subscription_packages_admin"
      );

      return rows
        .map((row): SubscriptionPackageAdmin => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          description: row.description || null,
          period: (row.period as Enums<"subscription_period">) ?? "monthly",
          tier: (row.tier as Enums<"membership_tier">) ?? "basic",
          price: Number(row.price ?? 0),
          currency: row.currency,
          governance_tokens: row.governance_tokens ?? 0,
          impact_tokens: row.impact_tokens ?? 0,
          is_active: row.is_active,
          is_recurring: row.is_recurring ?? false,
          sort_order: row.sort_order ?? 0,
          stripe_price_id: row.stripe_price_id || null,
          // Localization fields
          name_key: row.name_key || null,
          description_key: row.description_key || null,
          base_locale: row.base_locale || null,
        }))
        .sort((a, b) => a.sort_order - b.sort_order);
    },
    enabled: isAdmin && !!user,
  });
}

export interface CreateSubscriptionPackageParams {
  name: string;
  slug: string;
  description?: string | null;
  tier: Enums<"membership_tier">;
  period: Enums<"subscription_period">;
  /** Price denominated in the instance base currency (see p_currency below). */
  price: number;
  governance_tokens?: number;
  impact_tokens?: number;
  is_active?: boolean;
  is_recurring?: boolean;
  sort_order?: number;
  stripe_price_id?: string | null;
}

export function useCreateSubscriptionPackage() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  const { data: baseCurrency = BASE_CURRENCY_FALLBACK } = useCommerceBaseCurrency();

  return useMutation({
    mutationFn: guardAdminMutation("create_subscription_package_admin", async (data: CreateSubscriptionPackageParams) => {
      const { error } = await aisha.rpc("create_subscription_package_admin", {
        p_code: data.slug,
        // Admin enters price in the instance base currency, resolved from config
        // (system_config → commerce_base_currency), never a hardcoded fiat code.
        p_currency: baseCurrency,
        p_description: data.description ?? undefined,
        p_display_order: data.sort_order ?? 0,
        p_features: [],
        p_is_active: data.is_active ?? true,
        p_is_recurring: data.is_recurring ?? false,
        p_name: data.name,
        p_period: data.period,
        p_price: data.price,
        p_stripe_price_id: data.stripe_price_id ?? undefined
,
        p_tier: data.tier,
        p_tokens_governance: data.governance_tokens ?? 0,
        p_tokens_impact: data.impact_tokens ?? 0
    });
      if (error) {
        safeError("admin.subscriptionPackages.createFailed", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-subscription-packages"] });
    },
  });
}

export interface UpdateSubscriptionPackageParams {
  id: string;
  name?: string;
  slug?: string;
  description?: string | null;
  tier?: Enums<"membership_tier">;
  period?: Enums<"subscription_period">;
  price?: number;
  governance_tokens?: number;
  impact_tokens?: number;
  is_active?: boolean;
  is_recurring?: boolean;
  sort_order?: number;
  stripe_price_id?: string | null;
}

export function useUpdateSubscriptionPackage() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();
  const { data: baseCurrency = BASE_CURRENCY_FALLBACK } = useCommerceBaseCurrency();

  return useMutation({
    mutationFn: guardAdminMutation("update_subscription_package_admin", async (params: UpdateSubscriptionPackageParams) => {
      const { id, ...data } = params;
      const { error } = await aisha.rpc("update_subscription_package_admin", {
        p_code: data.slug,
        p_currency: baseCurrency,
        p_description: data.description ?? undefined,
        p_display_order: data.sort_order ?? undefined,
        p_features: undefined,
        p_id: id,
        p_is_active: data.is_active ?? undefined,
        p_is_recurring: data.is_recurring ?? undefined,
        p_name: data.name,
        p_period: data.period ?? undefined,
        p_price: data.price ?? undefined,
        p_stripe_price_id: data.stripe_price_id ?? undefined
,
        p_tier: data.tier ?? undefined,
        p_tokens_governance: data.governance_tokens ?? undefined,
        p_tokens_impact: data.impact_tokens ?? undefined
    });
      if (error) {
        safeError("admin.subscriptionPackages.updateFailed", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-subscription-packages"] });
    },
  });
}

export function useDeleteSubscriptionPackage() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_subscription_package_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_subscription_package_admin", {
        p_id: id,
      });
      if (error) {
        safeError("admin.subscriptionPackages.deleteFailed", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-subscription-packages"] });
    },
  });
}
