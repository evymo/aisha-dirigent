/**
 * Currency hook for dynamic price conversion
 *
 * Provides currency rates and conversion utilities based on user's language preference
 * and optional user-selected currency.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { aisha } from "@/integrations/db/client";
import { z } from "zod";
import { safeError, safeWarn } from "@/lib/security/safeLogger";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useSession } from "./useSession";

// Re-exported for existing importers. The configured value
// (system_config → commerce_base_currency) is the real source; this constant
// only guards the loading/error edge. See @/lib/currency/constants.
export { BASE_CURRENCY_FALLBACK };
const PREFERRED_CURRENCY_STORAGE_KEY = "preferred_currency";
const CURRENCY_CHANGE_EVENT = "currency-change";

// Module-level shared state for immediate sync across all hook instances
let sharedCurrencyOverride: string | null = null;

// Schema for currency rate from RPC
const currencyRateSchema = z.object({
  code: z.string(),
  is_active: z.boolean(),
  is_base: z.boolean(),
  name: z.string().nullable().transform((v) => v ?? ""),
  name_native: z.string().nullable().transform((v) => v ?? ""),
  rate_to_base: z.number(),
  sort_order: z.number(),
  symbol: z.string(),
  updated_at: z.string(),
});

const profilePrefsSchema = z.object({
  preferred_language: z.string().nullable().optional(),
  preferred_currency: z.string().nullable().optional(),
});

export type CurrencyRate = z.infer<typeof currencyRateSchema>;

/**
 * Hook to fetch all available currency rates from the database.
 * Rates are used for price conversion across the application.
 *
 * @returns Query object containing list of currency rates.
 */
/**
 * Query options for fetching currency rates
 */
export const currencyRatesQueryOptions = (locale?: string) => ({
  queryKey: ["currency-rates", locale ?? "en"],
  queryFn: async () => {
    const { data, error } = await aisha.rpc("get_currency_rates", {
      p_locale: locale ?? "en",
    });

    if (error) {
      safeError("useCurrencyRates.fetch", error);
      throw new Error(error.message);
    }

    const parsed = z.array(currencyRateSchema).safeParse(data);
    if (!parsed.success) {
      safeError("useCurrencyRates.parse", parsed.error);
      return [] as CurrencyRate[];
    }

    return parsed.data;
  },
  staleTime: 5 * 60 * 1000, // 5 minutes
} as const);

/**
 * Hook to fetch all available currency rates from the database.
 * Rates are used for price conversion across the application.
 *
 * @returns Query object containing list of currency rates.
 */
export function useCurrencyRates() {
  const { i18n } = useTranslation();
  const locale = getTranslationLocale(i18n.language);
  return useQuery(currencyRatesQueryOptions(locale));
}

/**
 * Query options for fetching commerce base currency
 */
export const commerceBaseCurrencyQueryOptions = () => ({
  queryKey: ["system-config", "commerce_base_currency"],
  queryFn: async () => {
    const { data, error } = await aisha.rpc("get_system_config", {
      p_key: "commerce_base_currency",
    });
    if (error) {
      safeError("useCommerceBaseCurrency.fetch", error);
      return BASE_CURRENCY_FALLBACK;
    }

    // data is JSONB; handle scalar string or object
    if (typeof data === "string" && data.trim()) return data.toUpperCase();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;
      const raw = record["code"];
      if (typeof raw === "string" && raw.trim()) return raw.toUpperCase();
      const scalar = record[""];
      if (typeof scalar === "string" && scalar.trim()) return scalar.toUpperCase();
    }

    // For JSONB scalar string, PostgREST may return e.g. "CZK" as string already
    if (data == null) return BASE_CURRENCY_FALLBACK;

    try {
      const maybeStringable = data as { toString?: () => string };
      if (typeof maybeStringable.toString === "function") {
        const scalar = maybeStringable.toString();
        if (scalar && scalar !== "[object Object]") return scalar.replace(/"/g, "").toUpperCase();
      }
    } catch {
      // ignore
    }

    return BASE_CURRENCY_FALLBACK;
  },
  staleTime: 10 * 60 * 1000,
} as const);

/**
 * Hook to fetch base commerce currency from system config.
 */
export function useCommerceBaseCurrency() {
  return useQuery(commerceBaseCurrencyQueryOptions());
}

/**
 * Hook to determine the preferred currency from the user's explicit selection
 * (profile preference or stored override), falling back to the instance base
 * currency read from config. Currency is data/config — never derived from the
 * UI language via a hardcoded fiat map.
 */
export function usePreferredCurrency(): string {
  const { user } = useSession();
  const { data: baseCurrency = BASE_CURRENCY_FALLBACK } = useCommerceBaseCurrency();
  const [storedCurrency, setStoredCurrency] = useState<string | null>(null);

  const { data: profilePrefs } = useQuery({
    queryKey: ["profile-preferences", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_my_profile_preferences_audited");
      if (error) {
        safeError("usePreferredCurrency.profilePrefs", error);
        return null;
      }
      const parsed = profilePrefsSchema.safeParse(Array.isArray(data) ? data[0] : data);
      if (!parsed.success) {
        safeError("usePreferredCurrency.profilePrefs.parse", parsed.error);
        return null;
      }
      return parsed.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setStoredCurrency(window.localStorage.getItem(PREFERRED_CURRENCY_STORAGE_KEY));
    } catch (err) {
      safeWarn("useCurrency.preferred.localStorageUnavailable", err);
      setStoredCurrency(null);
    }
  }, []);

  const preferred =
    profilePrefs?.preferred_currency || storedCurrency || baseCurrency;

  return preferred.toUpperCase();
}

/**
 * Main currency hook providing conversion utilities and formatting.
 * Automatically handles conversion based on current rates and user preference.
 */
export function useCurrency() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { data: rates = [], isLoading } = useCurrencyRates();
  const { data: baseCurrency = BASE_CURRENCY_FALLBACK } = useCommerceBaseCurrency();
  const preferredCurrency = usePreferredCurrency();
  const [storedCurrency, setStoredCurrency] = useState<string | null>(null);
  // Local state synced with module-level shared state for immediate cross-instance updates
  const [localOverride, setLocalOverride] = useState<string | null>(sharedCurrencyOverride);

  // Listen for currency change events from other hook instances
  useEffect(() => {
    const handleCurrencyChange = (event: CustomEvent<string>) => {
      setLocalOverride(event.detail);
    };

    window.addEventListener(CURRENCY_CHANGE_EVENT, handleCurrencyChange as EventListener);
    return () => {
      window.removeEventListener(CURRENCY_CHANGE_EVENT, handleCurrencyChange as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setStoredCurrency(window.localStorage.getItem(PREFERRED_CURRENCY_STORAGE_KEY));
    } catch (err) {
      safeWarn("useCurrency.localStorageUnavailable", err);
      setStoredCurrency(null);
    }
  }, []);

  const availableCurrencies = useMemo(() => {
    if (rates.length > 0) {
      return rates.filter((r) => r.is_active).map((r) => r.code);
    }
    // Rates not yet loaded — expose only the instance base currency so nothing
    // hardcodes a fiat set. The full active list arrives with `rates`.
    return [baseCurrency.toUpperCase()];
  }, [rates, baseCurrency]);

  const normalizedPreferred = useMemo(() => {
    // Use local override first for immediate update
    const source = localOverride || preferredCurrency;
    const normalized = source.toUpperCase();
    if (!availableCurrencies.includes(normalized)) {
      return baseCurrency.toUpperCase();
    }
    return normalized;
  }, [localOverride, preferredCurrency, availableCurrencies, baseCurrency]);

  const getRateToCzk = useCallback(
    (currencyCode: string): number | null => {
      const rate = rates.find((r) => r.code === currencyCode.toUpperCase());
      return rate?.rate_to_base ?? null;
    },
    [rates]
  );

  /**
   * Convert amount between any two currencies using rate_to_base.
   * 
   * rate_to_base means "how many CZK for 1 unit of this currency"
   * e.g., EUR rate_to_base = 25 means 1 EUR = 25 CZK
   * 
   * To convert FROM currency A TO currency B:
   * 1. Convert A to CZK: amount * rateFrom
   * 2. Convert CZK to B: czk / rateTo
   * Combined: amount * (rateFrom / rateTo)
   */
  const convertAmount = (amount: number, fromCurrency: string, toCurrency: string): number => {
    const fromCode = fromCurrency.toUpperCase();
    const toCode = toCurrency.toUpperCase();

    if (fromCode === toCode) return amount;

    const rateFrom = getRateToCzk(fromCode);
    const rateTo = getRateToCzk(toCode);

    if (!rateFrom || !rateTo) return amount;

    // Convert: amount in fromCurrency → CZK → toCurrency
    // amount * rateFrom = CZK value
    // CZK value / rateTo = toCurrency value
    return amount * (rateFrom / rateTo);
  };

  /**
   * Convert price from base currency to target currency.
   */
  const convertFromBase = (amountBase: number, toCurrency?: string): number => {
    const targetCode = toCurrency ?? normalizedPreferred;
    return convertAmount(amountBase, baseCurrency, targetCode);
  };

  /**
   * Format amount in a given currency (no conversion).
   */
  const formatCurrency = (amount: number, currencyCode?: string | null): string => {
    // Currency is data — when a row carries no currency, format in the instance
    // base currency (from config) rather than a hardcoded fiat literal.
    const code = (currencyCode || baseCurrency).toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (err) {
      // Intl.NumberFormat throws RangeError on unsupported currency codes —
      // fall back to symbol+number formatting derived from rates table.
      safeWarn("useCurrency.format.unsupportedCurrency", err);
      const symbol = rates.find((r) => r.code === code)?.symbol ?? code;
      return `${amount.toFixed(2)} ${symbol}`;
    }
  };

  /**
   * Format base currency price in target currency.
   */
  const formatPrice = (amountBase: number, currency?: string): string => {
    const targetCode = currency ?? normalizedPreferred;
    const convertedAmount = convertFromBase(amountBase, targetCode);
    return formatCurrency(convertedAmount, targetCode);
  };

  const setPreferredCurrency = async (currencyCode: string) => {
    const normalized = currencyCode.toUpperCase();
    
    // Update module-level shared state and local state
    sharedCurrencyOverride = normalized;
    setLocalOverride(normalized);
    
    // Broadcast to all other hook instances
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CURRENCY_CHANGE_EVENT, { detail: normalized }));
    }
    
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PREFERRED_CURRENCY_STORAGE_KEY, normalized);
      }
      setStoredCurrency(normalized);
    } catch {
      // ignore localStorage errors
    }

    // Force re-render all components that display prices
    // This ensures immediate visual update without page refresh
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["cart"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    queryClient.invalidateQueries({ queryKey: ["shop"] });

    if (user) {
      const { error } = await aisha.rpc("update_my_profile_contact_audited", {
        p_preferred_currency: normalized,
      });
      if (error) {
        safeError("useCurrency.setPreferredCurrency", error);
      } else {
        // Invalidate profile preferences to sync across components
        queryClient.invalidateQueries({ queryKey: ["profile-preferences"] });
      }
    }
  };

  return {
    rates,
    isLoading,
    baseCurrency: baseCurrency.toUpperCase(),
    preferredCurrency: normalizedPreferred,
    storedCurrency,
    availableCurrencies,
    convertAmount,
    convertFromBase,
    formatCurrency,
    formatPrice,
    getRateToCzk,
    setPreferredCurrency,
  };
}
