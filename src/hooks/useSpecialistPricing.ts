/**
 * Hook for specialist pricing management — set and update rates.
 *
 * @module hooks/useSpecialistPricing
 */

import { useMutation, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  specialistPricingSchema,
  type SpecialistPricing,
} from "@/lib/schemas/marketplaceSchemas";

// =============================================================================
// Query Keys
// =============================================================================

export const pricingKeys = {
  all: ["specialist-pricing"] as const,
  my: () => ["specialist-pricing", "my"] as const,
};

// =============================================================================
// Types
// =============================================================================

export interface UpdatePricingParams {
  hourlyRateCzk?: number;
  minBlockHours?: number;
  maxConcurrentProjects?: number;
  instantBookingEnabled?: boolean;
  isActive?: boolean;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to update specialist's own pricing settings.
 *
 * @returns Mutation for updating pricing.
 *
 * @example
 * const { mutateAsync: updatePricing } = useUpdateSpecialistPricing();
 * await updatePricing({ hourlyRateCzk: 4000, minBlockHours: 2 });
 */
export function useUpdateSpecialistPricing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdatePricingParams) => {
      const { data, error } = await aisha.rpc("update_specialist_pricing_audited", {
        p_hourly_rate: params.hourlyRateCzk ?? undefined,
        p_instant_booking_enabled: params.instantBookingEnabled ?? undefined,
        p_is_active: params.isActive ?? undefined,
        p_max_concurrent_projects: params.maxConcurrentProjects ?? undefined,
        p_min_block_hours: params.minBlockHours ?? undefined,
      });

      if (error) {
        safeError("pricing.update", error);
        throw new Error(error.message);
      }

      const result = data as unknown as { success: boolean; pricing_id?: string; error?: string };
      if (!result.success) {
        throw new Error(result.error ?? "Pricing update failed");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pricingKeys.all });
    },
    onError: (error) => {
      safeError("pricing.update.failed", error);
    },
  });
}
