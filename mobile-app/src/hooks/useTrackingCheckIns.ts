import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/config/api";
import { trackingCheckInSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { TrackingCheckIn } from "@/types/schemas";

function parseCheckInArray(data: unknown): TrackingCheckIn[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<TrackingCheckIn[]>((acc, item) => {
    const result = trackingCheckInSchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

export function useTrackingCheckIns(userId: string | undefined, limit = 5) {
  return useQuery({
    queryKey: ["health-check-ins", userId, limit],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_health_check_ins_audited", {
        p_limit: limit,
      });
      if (error) {
        safeError("useTrackingCheckIns.fetch", error);
        throw error;
      }
      return parseCheckInArray(data);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export interface CreateTrackingCheckInParams {
  check_in_type?: "morning" | "evening";
  pain_level?: number | null;
  sleep_quality?: number | null;
  sleep_hours?: number | null;
  energy_level?: number | null;
  mood_level?: number | null;
  took_medication?: boolean | null;
  medication_notes?: string | null;
  side_effects?: string | null;
  notes?: string | null;
}

export function useCreateTrackingCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: CreateTrackingCheckInParams) => {
      const { data, error } = await api.rpc("create_health_check_in", {
        p_check_in_type: params.check_in_type ?? "morning",
        p_energy_level: params.energy_level ?? undefined,
        p_general_notes: params.notes ?? undefined,
        p_medication_notes: params.medication_notes ?? undefined,
        p_mood_level: params.mood_level ?? undefined,
        p_pain_level: params.pain_level ?? undefined,
        p_side_effects: params.side_effects ?? undefined,
        p_sleep_hours: params.sleep_hours ?? undefined,
        p_sleep_quality: params.sleep_quality ?? undefined,
        p_took_medication: params.took_medication ?? undefined,
      });
      if (error) {
        safeError("useCreateTrackingCheckIn.submit", error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["health-check-ins"] });
      qc.invalidateQueries({ queryKey: ["gamification-stats"] });
    },
  });
}
