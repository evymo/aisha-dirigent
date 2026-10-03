import { useState } from "react";
import { useTranslation } from "react-i18next";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "./useSession";
import { toast } from "sonner";
import { type SubscriptionPackage } from "./useMembership";
import { useCurrency } from "./useCurrency";
import {
  type PaymentType,
  type CheckoutResult,
  type SubscriptionStatus,
  checkoutResultSchema,
  subscriptionStatusSchema,
  customerPortalResultSchema,
} from "@/lib/schemas/stripeSchemas";
import { parseRpcResponseSafe } from "@/lib/schemas/hookSchemas";

// Re-export PaymentType for convenience
export type { PaymentType } from "@/lib/schemas/stripeSchemas";

/**
 * Hook for Stripe subscription checkout operations.
 * Supports both one-time and recurring payment types.
 * 
 * @returns Object containing checkout methods and loading state.
 */
export function useStripeCheckout() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { preferredCurrency } = useCurrency();
  const [loading, setLoading] = useState(false);

  /**
   * Create a Stripe checkout session for a subscription package.
   * 
   * @param pkg - The subscription package to purchase.
   * @param paymentType - The type of payment (one-time or recurring).
   * @param subscriptionId - Optional existing approved subscription request to pay.
   * @returns The checkout result containing the session URL, or null if failed.
   */
  const createSubscriptionCheckout = async (
    pkg: SubscriptionPackage,
    paymentType: PaymentType,
    subscriptionId?: string
  ): Promise<CheckoutResult | null> => {
    if (!user) {
      toast.error(t("subscription.authRequired"), { description: t("subscription.authRequiredDesc") });
      return null;
    }

    setLoading(true);

    try {
      const { data, error } = await aisha.functions.invoke(
        "create-subscription-checkout",
        {
          body: {
            packageId: pkg.id,
            paymentType,
            currency: preferredCurrency,
            subscriptionId,
          },
        }
      );

      if (error) throw new Error(error.message);

      // Validate response with Zod
      const validated = parseRpcResponseSafe(
        checkoutResultSchema,
        data,
        "createSubscriptionCheckout"
      );

      if (!validated?.url) {
        throw new Error("Invalid checkout response structure");
      }

      // Open Stripe Checkout in new tab
      window.open(validated.url, "_blank");

      toast.success(t("subscription.checkoutStarted"), { description: t("subscription.checkoutStartedDesc") });

      return validated;
    } catch (error) {
      safeError("useStripeCheckout.createSubscriptionCheckout", error);
      toast.error(t("subscription.checkoutFailed"), { description: t("errors.genericError") });
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Check current subscription status from Stripe.
   */
  const checkSubscriptionStatus = async (): Promise<SubscriptionStatus | null> => {
    if (!user) return null;

    try {
      const { data, error } = await aisha.functions.invoke(
        "check-subscription-status"
      );

      if (error) throw new Error(error.message);

      // Validate response with Zod
      const validated = parseRpcResponseSafe(
        subscriptionStatusSchema,
        data,
        "checkSubscriptionStatus"
      );

      return validated;
    } catch (error) {
      safeError("useStripeCheckout.checkSubscriptionStatus", error);
      return null;
    }
  };

  /**
   * Open Stripe Customer Portal for subscription management.
   */
  const openCustomerPortal = async (): Promise<boolean> => {
    if (!user) {
      toast.error(t("subscription.authRequired"));
      return false;
    }

    setLoading(true);

    try {
      const { data, error } = await aisha.functions.invoke(
        "customer-portal"
      );

      if (error) throw new Error(error.message);

      // Validate response with Zod
      const validated = parseRpcResponseSafe(
        customerPortalResultSchema,
        data,
        "openCustomerPortal"
      );

      if (!validated?.url) {
        throw new Error("Invalid portal response structure");
      }

      window.open(validated.url, "_blank");
      return true;
    } catch (error) {
      safeError("useStripeCheckout.openCustomerPortal", error);
      toast.error(t("subscription.portalFailed"), { description: t("errors.genericError") });
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    createSubscriptionCheckout,
    checkSubscriptionStatus,
    openCustomerPortal,
  };
}
