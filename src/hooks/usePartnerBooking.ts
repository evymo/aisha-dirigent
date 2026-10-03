import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

import type { ApiClient } from "@/integrations/api/client";

interface CreateAppointmentParams {
  partner_id: string;
  member_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  appointment_type: "online" | "in_person";
  notes?: string;
  service?: string;
}

interface UseCreateAppointmentOptions {
  client?: ApiClient;
}

/**
 * Hook for creating partner appointments.
 * Can use sensitive data client if sharing health data.
 */
export function useCreatePartnerAppointment(options?: UseCreateAppointmentOptions) {
  const queryClient = useQueryClient();
  const client = options?.client ?? aisha;

  return useMutation({
    mutationFn: async (params: CreateAppointmentParams) => {
      const { data, error } = await client.rpc("create_partner_appointment_audited", {
        p_appointment_date: params.appointment_date,
        p_appointment_type: params.appointment_type,
        p_end_time: params.end_time,
        p_member_id: params.member_id,
        p_notes: params.notes,
        p_partner_id: params.partner_id,
        p_service: params.service
,
        p_start_time: params.start_time
    });

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_, variables) => {
      // Invalidate partner appointments queries
      queryClient.invalidateQueries({ queryKey: ["partner-appointments", variables.partner_id] });
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
    },
    onError: (error) => {
      safeError("partner.booking.createFailed", error);
    },
  });
}
