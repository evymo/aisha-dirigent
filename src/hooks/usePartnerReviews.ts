import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { parseArrayResponseSafe } from "@/lib/schemas/hookSchemas";
import {
  partnerAppointmentReviewArraySchema,
  type PartnerAppointmentReviewRpc,
} from "@/lib/schemas/partnerReviewSchemas";

export type PartnerAppointmentReview = PartnerAppointmentReviewRpc;

/**
 * Hook to fetch reviews for a specific partner.
 *
 * @param partnerId - The ID of the partner to fetch reviews for.
 * @returns Query result containing the list of reviews.
 */
export function usePartnerReviews(partnerId: string) {
  return useQuery({
    queryKey: ["partner-reviews", partnerId],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_partner_appointment_reviews", {
        p_partner_id: partnerId,
      });

      if (error) throw new Error(error.message);
      
      // Validate with Zod
      return parseArrayResponseSafe(
        partnerAppointmentReviewArraySchema,
        data,
        "get_partner_appointment_reviews"
      );
    },
    enabled: !!partnerId,
  });
}

/**
 * Hook to calculate rating statistics for a partner.
 *
 * @param partnerId - The ID of the partner.
 * @returns Object containing total reviews, average rating, and rating distribution.
 */
export function usePartnerRatingStats(partnerId: string) {
  const { data: reviews = [] } = usePartnerReviews(partnerId);

  const totalReviews = reviews.length;
  const averageRating = totalReviews > 0 
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews 
    : 0;
  
  const ratingDistribution = [5, 4, 3, 2, 1].map(rating => ({
    rating,
    count: reviews.filter(r => r.rating === rating).length,
    percentage: totalReviews > 0 
      ? (reviews.filter(r => r.rating === rating).length / totalReviews) * 100 
      : 0,
  }));

  return {
    totalReviews,
    averageRating: Math.round(averageRating * 10) / 10,
    ratingDistribution,
    reviews,
  };
}

/**
 * Hook to fetch a review for a specific appointment.
 *
 * @param appointmentId - The ID of the appointment.
 * @returns Query result containing the review or null if not found.
 */
export function useAppointmentReview(appointmentId: string) {
  return useQuery({
    queryKey: ["appointment-review", appointmentId],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_appointment_review", {
        p_appointment_id: appointmentId,
      });

      if (error) throw new Error(error.message);
      
      // Validate with Zod and get first item
      const reviews = parseArrayResponseSafe(
        partnerAppointmentReviewArraySchema,
        data,
        "get_appointment_review"
      );
      return reviews.length > 0 ? reviews[0] : null;
    },
    enabled: !!appointmentId,
  });
}

/**
 * Hook to create a new review for an appointment.
 *
 * @returns Mutation object for creating a review.
 */
export function useCreateAppointmentReview() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async ({
      appointmentId,
      partnerId,
      rating,
      comment,
    }: {
      appointmentId: string;
      partnerId: string;
      rating: number;
      comment?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await aisha.rpc("create_partner_appointment_review", {
        p_appointment_id: appointmentId,
        p_comment: comment ?? undefined
,
        p_partner_id: partnerId,
        p_rating: rating
    });

      if (error) throw new Error(error.message);
      const result = data as { id: string; appointment_id: string; partner_id: string }[] | null;
      if (!result || result.length === 0) throw new Error("Failed to create review");
      return result[0];
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["partner-reviews", data.partner_id] });
      queryClient.invalidateQueries({ queryKey: ["appointment-review", data.appointment_id] });
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
    },
  });
}

/**
 * Hook to update an existing appointment review.
 *
 * @returns Mutation object for updating a review.
 */
export function useUpdateAppointmentReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      rating,
      comment,
    }: {
      id: string;
      rating: number;
      comment?: string;
    }) => {
      const { data, error } = await aisha.rpc("update_partner_appointment_review", {
        p_comment: comment ?? undefined
,
        p_rating: rating,
        p_review_id: id
    });

      if (error) throw new Error(error.message);
      const result = data as { id: string; appointment_id: string; partner_id: string }[] | null;
      if (!result || result.length === 0) throw new Error("Failed to update review");
      return result[0];
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["partner-reviews", data.partner_id] });
      queryClient.invalidateQueries({ queryKey: ["appointment-review", data.appointment_id] });
    },
  });
}
