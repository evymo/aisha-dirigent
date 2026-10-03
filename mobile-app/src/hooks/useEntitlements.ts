/**
 * Entitlements hooks — the member's subscriptions + product access.
 *
 * These are the "services consumed as products" surface that exists today.
 * NOTE: there is no single unified consumption ledger RPC (see
 * mobile-app/docs/WIRE_UP_COMPLETION_PLAN.md §4) — we surface the existing
 * pieces (subscriptions + product access) rather than invent one.
 *
 * Backed by: get_my_subscriptions, get_my_product_access,
 * get_subscription_packages, get_my_wallet_balance,
 * get_token_reward_rules_localized, fn_get_llm_quota_status.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import {
  llmQuotaStatusSchema,
  productAccessSchema,
  subscriptionPackageSchema,
  subscriptionSchema,
  tokenRewardRuleSchema,
  walletBalanceSchema,
} from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type {
  LlmQuotaStatus,
  ProductAccess,
  Subscription,
  SubscriptionPackage,
  TokenRewardRule,
  WalletBalance,
} from "@/types/schemas";

function parseArray<T>(
  data: unknown,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<T[]>((acc, item) => {
    const r = schema.safeParse(item);
    if (r.success && r.data !== undefined) acc.push(r.data);
    return acc;
  }, []);
}

/** The member's subscriptions (active + historical). */
export function useMySubscriptions(userId: string | undefined) {
  return useQuery<Subscription[]>({
    queryKey: ["my-subscriptions", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_subscriptions");
      if (error) {
        safeError("useMySubscriptions.fetch", error);
        throw error;
      }
      return parseArray<Subscription>(data, subscriptionSchema);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Products the member has been granted access to. */
export function useMyProductAccess(userId: string | undefined) {
  return useQuery<ProductAccess[]>({
    queryKey: ["my-product-access", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_product_access");
      if (error) {
        safeError("useMyProductAccess.fetch", error);
        throw error;
      }
      return parseArray<ProductAccess>(data, productAccessSchema);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Instance base fiat currency (system_config → commerce_base_currency), the
 * single source of truth for the currency this instance transacts in. Used only
 * as a fallback when a row carries no explicit currency of its own — never a
 * baked fiat literal.
 */
export function useCommerceBaseCurrency() {
  return useQuery<string>({
    queryKey: ["commerce-base-currency"],
    queryFn: async () => {
      const { data, error } = await api.rpc("commerce_base_currency");
      if (error) {
        safeError("useCommerceBaseCurrency.fetch", error);
        throw error;
      }
      return String(data ?? "").toUpperCase();
    },
    staleTime: 30 * 60 * 1000,
  });
}

/** Localized subscription package catalog a member can compare against. */
export function useSubscriptionPackages(locale = "en") {
  return useQuery<SubscriptionPackage[]>({
    queryKey: ["subscription-packages", locale],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_subscription_packages", { p_locale: locale });
      if (error) {
        safeError("useSubscriptionPackages.fetch", error);
        throw error;
      }
      return parseArray<SubscriptionPackage>(data, subscriptionPackageSchema);
    },
    staleTime: 10 * 60 * 1000,
  });
}

/** Current token wallet row from the DB source of truth. */
export function useWalletBalance(userId: string | undefined) {
  return useQuery<WalletBalance | null>({
    queryKey: ["wallet-balance", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_wallet_balance");
      if (error) {
        safeError("useWalletBalance.fetch", error);
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const result = walletBalanceSchema.safeParse(row);
      return result.success ? result.data : null;
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

/** Reward earn rules, localized by backend translation fallback. */
export function useTokenRewardRules(locale = "en") {
  return useQuery<TokenRewardRule[]>({
    queryKey: ["token-reward-rules", locale],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_token_reward_rules_localized", { p_locale: locale });
      if (error) {
        safeError("useTokenRewardRules.fetch", error);
        throw error;
      }
      return parseArray<TokenRewardRule>(data, tokenRewardRuleSchema);
    },
    staleTime: 10 * 60 * 1000,
  });
}

/** Read-only LLM quota status for the current member. */
export function useLlmQuotaStatus(userId: string | undefined) {
  return useQuery<LlmQuotaStatus | null>({
    queryKey: ["llm-quota-status", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("fn_get_llm_quota_status", {});
      if (error) {
        safeError("useLlmQuotaStatus.fetch", error);
        throw error;
      }
      const result = llmQuotaStatusSchema.safeParse(data);
      return result.success ? result.data : null;
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}
