/**
 * Hooks for consultation booking lifecycle — create, confirm, complete.
 *
 * @module hooks/useConsultationBooking
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { marketplaceKeys } from "./useMarketplace";
import type { Json } from "@/integrations/db/types";

// =============================================================================
// Types
// =============================================================================

export interface CreateBookingParams {
  specialistId: string;
  durationHours?: number;
  scheduledStart?: string | null;
  description?: string;
  tags?: string[];
  preferredCommunication?: string;
  urgency?: string;
}

interface BookingRpcResult {
  success: boolean;
  booking_id?: string;
  story_id?: string;
  price?: number;
  currency?: string;
  error?: string;
}

interface ConfirmBookingParams {
  bookingId: string;
  action: "confirm" | "reject";
  rejectReason?: string;
}

interface CompleteBookingParams {
  bookingId: string;
  actualHours?: number;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to create a new consultation booking.
 *
 * @returns Mutation for creating a booking.
 *
 * @example
 * const { mutateAsync: createBooking } = useCreateBooking();
 * const result = await createBooking({
 *   specialistId: "uuid",
 *   durationHours: 4,
 *   description: "React architecture review",
 * });
 */
export function useCreateBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateBookingParams): Promise<BookingRpcResult> => {
      const { data, error } = await aisha.rpc("create_consultation_booking_audited", {
        p_description: params.description ?? "",
        p_duration_hours: params.durationHours ?? 4,
        p_preferred_communication: params.preferredCommunication ?? "written",
        p_scheduled_start: params.scheduledStart ?? undefined,
        p_specialist_id: params.specialistId,
        p_tags: params.tags ?? [],
        p_urgency: params.urgency ?? "normal",
      });

      if (error) {
        safeError("booking.create", error);
        throw new Error(error.message);
      }

      const result = data as unknown as BookingRpcResult;
      if (!result.success) {
        throw new Error(result.error ?? "Booking creation failed");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
    },
    onError: (error) => {
      safeError("booking.create.failed", error);
    },
  });
}

/**
 * Hook for specialist to confirm or reject a booking.
 *
 * @returns Mutation for confirming/rejecting a booking.
 */
export function useConfirmBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ConfirmBookingParams): Promise<BookingRpcResult> => {
      const { data, error } = await aisha.rpc("confirm_booking_specialist_audited", {
        p_action: params.action,
        p_booking_id: params.bookingId,
        p_reject_reason: params.rejectReason ?? undefined,
      });

      if (error) {
        safeError("booking.confirm", error);
        throw new Error(error.message);
      }

      const result = data as unknown as BookingRpcResult;
      if (!result.success) {
        throw new Error(result.error ?? "Booking action failed");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
    },
    onError: (error) => {
      safeError("booking.confirm.failed", error);
    },
  });
}

/**
 * Hook to complete a booking and trigger revenue split calculation.
 *
 * @returns Mutation for completing a booking.
 */
export function useCompleteBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CompleteBookingParams): Promise<BookingRpcResult> => {
      const { data, error } = await aisha.rpc("complete_booking_audited", {
        p_actual_hours: params.actualHours ?? undefined,
        p_booking_id: params.bookingId,
      });

      if (error) {
        safeError("booking.complete", error);
        throw new Error(error.message);
      }

      const result = data as unknown as BookingRpcResult;
      if (!result.success) {
        throw new Error(result.error ?? "Booking completion failed");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all });
      queryClient.invalidateQueries({ queryKey: ["earnings"] });
    },
    onError: (error) => {
      safeError("booking.complete.failed", error);
    },
  });
}
