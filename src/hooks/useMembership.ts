import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { useIsMountedRef } from "./useIsMountedRef";
import {
  membershipSchema,
  subscriptionPackageArraySchema,
  parseFirstItemSafe,
  parseArrayResponseSafe,
} from "@/lib/schemas/hookSchemas";

export type MembershipTier = "basic" | "upgraded" | "trial";

/**
 * Represents a user's membership status and details.
 */
export interface Membership {
  /** Unique identifier for the membership record */
  id: string;
  /** ID of the user who owns this membership */
  user_id: string;
  /** Current membership tier */
  tier: MembershipTier;
  /** Current status of the membership */
  status: "active" | "expired" | "cancelled" | "pending";
  /** Type of payment used for the membership */
  payment_type: "one_time" | "recurring";
  /** Billing period for recurring subscriptions */
  subscription_period: "monthly" | "quarterly" | "annual" | null;
  /** Stripe subscription ID if applicable */
  stripe_subscription_id: string | null;
  /** Stripe customer ID if applicable */
  stripe_customer_id: string | null;
  /** Date when the membership started */
  starts_at: string;
  /** Date when the membership expires (null for active recurring) */
  expires_at: string | null;
  /** Whether the membership is set to auto-renew */
  auto_renew: boolean | null;
  /** Number of PLATFORM reward tokens */
  tokens_aisha: number | null;
  /** Number of governance tokens allocated */
  tokens_governance: number | null;
  /** Number of impact tokens allocated */
  tokens_impact: number | null;
  /** Number of data tokens allocated */
  tokens_data: number | null;
  /** Optional notes about the membership */
  notes: string | null;
  /** Timestamp of creation */
  created_at: string;
  /** Timestamp of last update */
  updated_at: string;
}

/**
 * Represents a purchasable subscription package.
 */
export interface SubscriptionPackage {
  /** Unique identifier for the package */
  id: string;
  /** Display name of the package */
  name: string;
  /** URL-friendly slug for the package */
  slug: string;
  /** Detailed description of the package */
  description: string | null;
  /** Membership tier granted by this package */
  tier: "basic" | "upgraded" | "trial";
  /** Billing period for the package */
  period: "monthly" | "quarterly" | "annual";
  /** Canonical price, denominated in `currency` (per-instance base currency) */
  price: number;
  /** Canonical currency code (e.g., CZK, USD) */
  currency: string;
  /** Whether this is a recurring subscription */
  is_recurring: boolean;
  /** Stripe price ID for checkout */
  stripe_price_id: string | null;
  /** List of product IDs included in the package */
  includes_products: string[] | null;
  /** List of diagnostic IDs included in the package */
  includes_diagnostics: string[] | null;
  /** Governance tokens granted by this package */
  governance_tokens: number;
  /** Impact tokens granted by this package */
  impact_tokens: number;
  /** Whether the package is currently available for purchase */
  is_active: boolean;
  /** Sort order for display */
  sort_order: number;
}

/**
 * Hook for managing user membership.
 * All DB access via RPC for centralized audit logging.
 * 
 * @returns Object containing membership data, loading state, and error state.
 */
export function useMembership() {
  const { user } = useSession();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMembership = useCallback(async (isMounted = { current: true }) => {
    if (!user) {
      if (isMounted.current) {
        setMembership(null);
        setLoading(false);
      }
      return;
    }

    try {
      const { data, error: rpcError } = await aisha.rpc("get_my_membership");

      if (rpcError) {
        throw rpcError;
      }

      if (isMounted.current) {
        // RPC returns array, get first item with Zod validation
        const membershipData = parseFirstItemSafe(membershipSchema, data, "get_my_membership");
        setMembership(membershipData as Membership | null);
      }
    } catch (err) {
      safeError("useMembership.fetchMembership", err);
      if (isMounted.current) {
        setError(getUserFacingDataErrorMessage(err));
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [user]);

  useEffect(() => {
    const isMounted = { current: true };
    fetchMembership(isMounted);
    return () => { isMounted.current = false; };
  }, [fetchMembership]);

  const createMembership = async (tier: Membership["tier"] = "basic") => {
    if (!user) return { error: "Not authenticated" };

    try {
      const { data, error: rpcError } = await aisha.rpc("create_membership", {
        p_tier: tier,
      });

      if (rpcError) {
        throw rpcError;
      }

      // RPC returns array, get first item
      const membershipData = Array.isArray(data) && data.length > 0 ? data[0] : data;
      setMembership(membershipData as Membership);
      return { data: membershipData, error: null };
    } catch (err) {
      safeError("useMembership.createMembership", err);
      return { data: null, error: getUserFacingDataErrorMessage(err) };
    }
  };

  const updateMembership = async (updates: Partial<Membership>) => {
    if (!user || !membership) return { error: "No membership found" };

    try {
      const { data, error: rpcError } = await aisha.rpc("update_my_membership", {
        p_updates: updates,
      });

      if (rpcError) {
        throw rpcError;
      }

      // RPC returns array, get first item
      const membershipData = Array.isArray(data) && data.length > 0 ? data[0] : data;
      setMembership(membershipData as Membership);
      return { data: membershipData, error: null };
    } catch (err) {
      safeError("useMembership.updateMembership", err);
      return { data: null, error: getUserFacingDataErrorMessage(err) };
    }
  };

  const isActive = membership?.status === "active";
  const isUpgraded = membership?.tier === "upgraded";
  const hasMembership = !!membership;

  return {
    membership,
    loading,
    error,
    isActive,
    isUpgraded,
    hasMembership,
    createMembership,
    updateMembership,
    refetch: fetchMembership,
  };
}

/**
 * Hook for fetching subscription packages.
 * All DB access via RPC for centralized audit logging.
 *
 * @returns Object containing packages list, loading state, and error state.
 */
export function useSubscriptionPackages() {
  const { i18n } = useTranslation();
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useIsMountedRef();
  const locale = i18n.language;

  useEffect(() => {
    async function fetchPackages() {
      try {
        const { data, error: rpcError } = await aisha.rpc("get_subscription_packages", {
          p_locale: locale,
        });

        if (rpcError) {
          throw rpcError;
        }

        if (isMountedRef.current) {
          // Validate with Zod and map to interface
          const validated = parseArrayResponseSafe(
            subscriptionPackageArraySchema,
            data,
            "get_subscription_packages"
          );
          const mapped: SubscriptionPackage[] = validated.map((p) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            description: p.description,
            tier: p.tier,
            period: p.period,
            price: p.price ?? 0,
            currency: p.currency ?? BASE_CURRENCY_FALLBACK,
            is_recurring: p.is_recurring,
            stripe_price_id: p.stripe_price_id,
            includes_products: p.includes_products,
            includes_diagnostics: p.includes_diagnostics,
            governance_tokens: p.governance_tokens,
            impact_tokens: p.impact_tokens,
            is_active: p.is_active,
            sort_order: p.sort_order ?? 0,
          }));
          setPackages(mapped);
        }
      } catch (err) {
        safeError("useSubscriptionPackages.fetchPackages", err);
        if (isMountedRef.current) {
          setError(getUserFacingDataErrorMessage(err));
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    }

    fetchPackages();
  }, [isMountedRef, locale]);

  return { packages, loading, error };
}
