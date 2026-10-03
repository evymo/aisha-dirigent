import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "./useSession";
import { toast } from "sonner";
import { type SubscriptionPackage } from "./useMembership";
import { useIsMountedRef } from "./useIsMountedRef";
import { subscriptionRpcArraySchema } from "@/lib/schemas/subscriptionSchemas";
import { useCurrency } from "./useCurrency";

/**
 * Represents a user's subscription.
 */
export interface MySubscription {
  id: string;
  user_id: string;
  package_id: string | null;
  amount_paid: number;
  currency: string;
  status: string;
  period_start: string;
  period_end: string;
  created_at: string;
  package: {
    name: string;
    tier: string;
    period: string;
    tokens_governance: number | null;
    tokens_impact: number | null;
    tokens_data: number | null;
  } | null;
}

/**
 * Hook to fetch the current user's subscriptions.
 *
 * @returns Query object containing the list of subscriptions.
 */
export function useMySubscriptions() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["my-subscriptions", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await aisha.rpc("get_my_subscriptions");

      if (error) throw new Error(error.message);
      
      // Validate with Zod
      const parsed = subscriptionRpcArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("useMySubscriptions.validation", parsed.error);
        return [];
      }
      
      // Transform validated data to expected shape - explicit return type, no cast needed
      return parsed.data.map((s): MySubscription => ({
        id: s.id,
        user_id: s.user_id,
        package_id: s.package_id,
        amount_paid: s.amount_paid,
        currency: s.currency || BASE_CURRENCY_FALLBACK,
        status: s.status,
        period_start: s.period_start,
        period_end: s.period_end,
        created_at: s.created_at,
        package: s.package_name ? {
          name: s.package_name,
          tier: s.package_tier || '',
          period: s.package_period || '',
          tokens_governance: s.tokens_governance ?? s.governance_tokens ?? null,
          tokens_impact: s.tokens_impact ?? s.impact_tokens ?? null,
          tokens_data: s.tokens_data ?? null,
        } : null,
      }));
    },
    enabled: !!user,
  });
}

/**
 * Hook for handling subscription purchases.
 *
 * This hook provides functionality to request a subscription package.
 * Note: This implementation currently simulates a purchase by directly inserting a subscription record.
 * In a real production environment, this would likely integrate with a payment provider like Stripe.
 *
 * @returns Object containing the purchase function and loading state.
 */
export function useSubscriptionPurchase() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { convertAmount, preferredCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const isMountedRef = useIsMountedRef();

  /**
   * Requests a subscription package.
   *
   * @param pkg - The subscription package to purchase.
   * @returns Promise resolving to true if successful, false otherwise.
   */
  const requestPackage = async (pkg: SubscriptionPackage) => {
    if (!user) {
      toast.error(t("subscription.authRequired"), { description: t("subscription.authRequiredDesc") });
      return false;
    }

    if (isMountedRef.current) {
      setLoading(true);
    }

    try {
      // Calculate period dates
      const now = new Date();
      const expiresAt = new Date(now);
      
      switch (pkg.period) {
        case "monthly":
          expiresAt.setMonth(expiresAt.getMonth() + 1);
          break;
        case "quarterly":
          expiresAt.setMonth(expiresAt.getMonth() + 3);
          break;
        case "annual":
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
          break;
      }

      // Create subscription request with "pending" status (waiting for admin approval)
      const targetCurrency = (preferredCurrency || pkg.currency).toUpperCase();
      const sourceCurrency = (pkg.currency || targetCurrency).toUpperCase();
      const convertedAmount = convertAmount(pkg.price, sourceCurrency, targetCurrency);
      const normalizedAmount = Number.isFinite(convertedAmount)
        ? Number(convertedAmount.toFixed(2))
        : pkg.price;

      const { error: subError } = await aisha.rpc("create_subscription_request", {
        p_amount_paid: normalizedAmount,
        p_currency: targetCurrency,
        p_package_id: pkg.id,
        p_period_end: expiresAt.toISOString()
,
        p_period_start: now.toISOString()
    });

      if (subError) throw subError;

      queryClient.invalidateQueries({ queryKey: ["my-subscriptions"] });

      toast.success(t("subscription.requested"), { description: t("subscription.requestedDesc", { name: pkg.name }) });

      return true;
    } catch (error) {
      safeError("Error requesting subscription", error);
      toast.error(t("subscription.requestFailed"), { description: t("subscription.requestFailedDesc") });
      return false;
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  return {
    requestPackage,
    loading,
  };
}
