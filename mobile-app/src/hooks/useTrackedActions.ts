/**
 * useTrackedActions (mobile) — universal read-model over a member's tracked
 * actions ("the user did / reacted to something"). Parity with the web hook
 * src/hooks/useTrackedActions.ts: one generic shape (action_type / occurred_at /
 * source / payload) across the thematic source tables, served by the
 * get_my_tracked_actions RPC.
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";

export const trackedActionSchema = z.object({
  id: z.string().uuid(),
  action_type: z.string(),
  occurred_at: z.string(),
  reminder_id: z.string().uuid().nullable(),
  source: z.string(),
  source_id: z.string().uuid(),
  // zod 4 (mobile) requires the 2-arg z.record(keySchema, valueSchema) form.
  payload: z.record(z.string(), z.unknown()),
});

export type TrackedAction = z.infer<typeof trackedActionSchema>;

export interface TrackedActionsOptions {
  /** ISO timestamp lower bound (inclusive). */
  since?: string;
  /** Restrict to a single action_type. */
  actionType?: string;
  /** Max rows (default 100). */
  limit?: number;
}

export const TRACKED_ACTIONS_QUERY_KEY = "tracked-actions";

/** Fetch the member's tracked actions (gated on userId, per the mobile pattern). */
export function useTrackedActions(
  userId: string | undefined,
  options: TrackedActionsOptions = {},
) {
  const { since, actionType, limit = 100 } = options;

  return useQuery<TrackedAction[]>({
    queryKey: [TRACKED_ACTIONS_QUERY_KEY, userId, since ?? null, actionType ?? null, limit],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_tracked_actions", {
        p_action_type: actionType,
        p_limit: limit,
        p_since: since,
      });
      if (error) {
        safeError("useTrackedActions.fetch", error);
        throw error;
      }
      const parsed = z.array(trackedActionSchema).safeParse(data ?? []);
      if (!parsed.success) {
        safeError("useTrackedActions.parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
