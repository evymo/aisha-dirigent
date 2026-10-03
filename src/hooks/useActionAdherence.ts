/**
 * useActionAdherence — per-reminder adherence over a window: expected occurrences
 * (from the reminder's frequency) vs actual completions. Closes the loop of the
 * tracked_action surface (events ⋈ schedule), served by get_my_action_adherence.
 *
 * @module
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "./useSession";

/** One reminder's adherence over the window. */
export const actionAdherenceSchema = z.object({
  reminder_id: z.string().uuid(),
  /** The reminder's type, in the universal action vocabulary. */
  action_type: z.string(),
  title: z.string(),
  expected: z.number(),
  actual: z.number(),
  /** actual / expected, capped at 1.0; null when nothing was expected. */
  adherence_ratio: z.number().nullable(),
  window_start: z.string(),
  window_end: z.string(),
});

export type ActionAdherence = z.infer<typeof actionAdherenceSchema>;

export const ACTION_ADHERENCE_QUERY_KEY = "action-adherence";

/** Fetch the caller's per-reminder adherence over the last `windowDays`. */
export function useActionAdherence(windowDays = 30) {
  const { user } = useSession();

  return useQuery({
    queryKey: [ACTION_ADHERENCE_QUERY_KEY, user?.id, windowDays],
    queryFn: async (): Promise<ActionAdherence[]> => {
      const { data, error } = await aisha.rpc("get_my_action_adherence", {
        p_window_days: windowDays,
      });
      if (error) {
        safeError("useActionAdherence", error);
        throw new Error(error.message);
      }
      const parsed = z.array(actionAdherenceSchema).safeParse(data ?? []);
      if (!parsed.success) {
        safeError("useActionAdherence.parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
}
