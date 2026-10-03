/**
 * Hook for rating specialists after consultation completion.
 *
 * @module hooks/useSpecialistRatings
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { marketplaceKeys } from "./useMarketplace";

// =============================================================================
// Types
// =============================================================================

export interface RateSpecialistParams {
  bookingId: string;
  ratingOverall: number;
  ratingCommunication?: number;
  ratingExpertise?: number;
  ratingDelivery?: number;
  comment?: string;
}

interface RatingResult {
  success: boolean;
  rating_id?: string;
  new_avg_rating?: number;
  error?: string;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to rate a specialist after completing a consultation.
 *
 * @returns Mutation for submitting a rating.
 *
 * @example
 * const { mutateAsync: rateSpecialist } = useRateSpecialist();
 * await rateSpecialist({
 *   bookingId: "uuid",
 *   ratingOverall: 5,
 *   comment: "Excellent work!",
 * });
 */
export function useRateSpecialist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: RateSpecialistParams): Promise<RatingResult> => {
      const { data, error } = await aisha.rpc("rate_specialist_audited", {
        p_booking_id: params.bookingId,
        p_comment: params.comment ?? undefined,
        p_rating_communication: params.ratingCommunication ?? undefined,
        p_rating_delivery: params.ratingDelivery ?? undefined,
        p_rating_expertise: params.ratingExpertise ?? undefined,
        p_rating_overall: params.ratingOverall,
      });

      if (error) {
        safeError("rating.submit", error);
        throw new Error(error.message);
      }

      const result = data as unknown as RatingResult;
      if (!result.success) {
        throw new Error(result.error ?? "Rating submission failed");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
    },
    onError: (error) => {
      safeError("rating.submit.failed", error);
    },
  });
}
