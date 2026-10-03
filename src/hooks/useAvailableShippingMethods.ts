/**
 * Hook for fetching available shipping methods from the Packeta edge function.
 *
 * Calls the `available-methods` action which returns pickup points, Z-BOXes,
 * carriers, costs, and free shipping threshold — all filtered by country
 * and postal code.
 *
 * @module hooks/useAvailableShippingMethods
 */

import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  availableMethodsResponseSchema,
  type AvailableMethodsResponse,
} from "@/lib/schemas/shippingCheckoutSchemas";

export interface AvailableMethodsParams {
  /** ISO 3166-1 alpha-2 country code (e.g., "CZ") */
  country: string;
  /** ISO 4217 currency code (e.g., "CZK") */
  currency?: string;
  /** User GPS latitude for proximity sorting */
  latitude?: number;
  /** User GPS longitude for proximity sorting */
  longitude?: number;
  /** Max points per category (default: 20, max: 50) */
  maxResults?: number;
  /** Order subtotal — used for free shipping calculation */
  orderSubtotal?: number;
  /** Postal code for regional filtering */
  postalCode?: string;
  /** Total package weight in grams */
  weightGrams?: number;
}

const EMPTY_RESPONSE: AvailableMethodsResponse = {
  carrierPickupPoints: [],
  carriers: [],
  costs: {},
  freeShippingThreshold: null,
  personalPickupAvailable: true,
  pickupPoints: [],
  totalBranchCount: 0,
  totalZboxCount: 0,
  zboxes: [],
};

/**
 * Fetches all available shipping methods for a given country/postal code.
 *
 * The edge function returns pickup points, Z-BOXes, carriers, costs, etc.
 * Data is cached for 5 minutes and refetched when params change.
 *
 * @param params - Filtering parameters (country is required)
 * @param enabled - Whether the query should execute
 * @returns TanStack Query result with AvailableMethodsResponse
 *
 * @example
 * ```ts
 * const { data, isLoading } = useAvailableShippingMethods({
 *   country: "CZ",
 *   postalCode: "110 00",
 *   orderSubtotal: 1200,
 * });
 * ```
 */
export function useAvailableShippingMethods(
  params: AvailableMethodsParams,
  enabled = true,
) {
  const {
    country,
    currency = BASE_CURRENCY_FALLBACK,
    latitude,
    longitude,
    maxResults = 20,
    orderSubtotal = 0,
    postalCode = "",
    weightGrams = 500,
  } = params;

  return useQuery({
    queryKey: [
      "available-shipping-methods",
      country,
      currency,
      latitude,
      longitude,
      maxResults,
      orderSubtotal,
      postalCode,
      weightGrams,
    ],
    queryFn: async (): Promise<AvailableMethodsResponse> => {
      const { data, error } = await aisha.functions.invoke("packeta-api", {
        body: {
          action: "available-methods",
          country: country.toUpperCase(),
          currency,
          latitude,
          longitude,
          maxResults,
          orderSubtotal,
          postalCode,
          weightGrams,
        },
      });

      if (error) {
        safeError("shipping.availableMethods.fetchFailed", error);
        throw new Error(error.message);
      }

      // Validate response shape
      const parsed = availableMethodsResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("shipping.availableMethods.parseError", {
          issues: parsed.error.issues.length,
        });
        safeError("shipping.availableMethods.schemaDropped", {
          raw_keys: data && typeof data === "object" ? Object.keys(data) : [],
        });
        return EMPTY_RESPONSE;
      }

      return parsed.data;
    },
    enabled: enabled && !!country,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
