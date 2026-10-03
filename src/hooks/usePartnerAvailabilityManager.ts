import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";
import { useSession } from "./useSession";

// ── Booking settings (slot_duration + buffer) ──────────────────────

const bookingSettingsSchema = z.object({
  buffer_minutes: z.number().int().min(0).max(60),
  slot_duration_minutes: z.number().int().min(10).max(240),
});

export type PartnerBookingSettings = z.infer<typeof bookingSettingsSchema>;

/**
 * Hook to read partner booking settings (slot duration, buffer).
 *
 * @param partnerId - The partner profile UUID.
 * @returns React Query result with validated {@link PartnerBookingSettings}.
 */
export function usePartnerBookingSettings(partnerId: string) {
  return useQuery({
    queryKey: ["partner-booking-settings", partnerId],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_partner_booking_settings", {
        p_partner_id: partnerId,
      });

      if (error) {
        safeError("partner.bookingSettings.fetchFailed", error);
        throw new Error(error.message);
      }

      const parsed = bookingSettingsSchema.safeParse(data);
      if (!parsed.success) {
        safeError("partner.bookingSettings.invalidData", parsed.error);
        throw new Error("Invalid booking settings data");
      }

      return parsed.data;
    },
    enabled: !!partnerId,
  });
}

/**
 * Hook to update partner booking settings (slot duration, buffer).
 *
 * @param partnerId - The partner profile UUID.
 * @returns Mutation that accepts {@link PartnerBookingSettings}.
 */
export function useUpdatePartnerBookingSettings(partnerId: string) {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async (settings: PartnerBookingSettings) => {
      if (!user) {
        throw new Error("Unauthorized");
      }
      if (!partnerId) {
        throw new Error("Missing partnerId");
      }

      const { error } = await aisha.rpc("update_partner_booking_settings", {
        p_buffer_minutes: settings.buffer_minutes,
        p_partner_id: partnerId,
        p_slot_duration_minutes: settings.slot_duration_minutes,
      });

      if (error) {
        safeError("partner.bookingSettings.updateFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-booking-settings", partnerId] });
      // Free slots depend on these settings
      queryClient.invalidateQueries({ queryKey: ["partner-free-slots"] });
    },
  });
}

// ── Availability slots ─────────────────────────────────────────────

// Zod schema for availability slot
const availabilitySlotSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string(),
  end_time: z.string(),
  is_online: z.boolean(),
  created_at: z.string(),
});

export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;

export interface NewAvailabilitySlot {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_online: boolean;
}

/**
 * Hook to fetch partner availability slots
 */
export function usePartnerAvailabilitySlots(partnerId: string) {
  return useQuery({
    queryKey: ["partner-availability", partnerId],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_partner_availability", {
        p_partner_id: partnerId,
      });

      if (error) {
        safeError("partner.availability.fetchFailed", error);
        throw new Error(error.message);
      }

      return parseRpcArray(availabilitySlotSchema, data, "get_partner_availability");
    },
    enabled: !!partnerId,
  });
}

/**
 * Hook to add a new availability slot
 */
export function useAddAvailabilitySlot(partnerId: string) {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async (slot: NewAvailabilitySlot) => {
      if (!user) {
        throw new Error("Unauthorized");
      }
      if (!partnerId) {
        throw new Error("Missing partnerId");
      }

      const { error } = await aisha.rpc("add_partner_availability", {
        p_day_of_week: slot.day_of_week,
        p_end_time: slot.end_time,
        p_is_online: slot.is_online
,
        p_partner_id: partnerId,
        p_start_time: slot.start_time
    });

      if (error) {
        safeError("partner.availability.addFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-availability", partnerId] });
    },
  });
}

/**
 * Hook to delete an availability slot
 */
export function useDeleteAvailabilitySlot(partnerId: string) {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async (slotId: string) => {
      if (!user) {
        throw new Error("Unauthorized");
      }
      if (!partnerId) {
        throw new Error("Missing partnerId");
      }

      const { error } = await aisha.rpc("delete_partner_availability", {
        p_availability_id: slotId,
      });

      if (error) {
        safeError("partner.availability.deleteFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-availability", partnerId] });
    },
  });
}

/**
 * Hook to toggle online/in-person status of a slot
 */
export function useToggleAvailabilityOnline(partnerId: string) {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async ({ slotId, isOnline }: { slotId: string; isOnline: boolean }) => {
      if (!user) {
        throw new Error("Unauthorized");
      }
      if (!partnerId) {
        throw new Error("Missing partnerId");
      }

      const { error } = await aisha.rpc("update_partner_availability_slot", {
        p_availability_id: slotId,
        p_is_online: isOnline,
      });

      if (error) {
        safeError("partner.availability.toggleFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-availability", partnerId] });
    },
  });
}
