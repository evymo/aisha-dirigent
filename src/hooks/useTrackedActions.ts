/**
 * useTrackedActions — universal read-model over a member's tracked actions
 * ("the user did / reacted to something").
 *
 * One generic shape — `action_type` / `occurred_at` / `source` / `payload` —
 * across the thematic source tables (reminder completions, dose logs, health
 * check-ins, questionnaire responses), served by the `get_my_tracked_actions`
 * RPC. Consumers depend only on this abstraction, never on the source-table
 * specifics.
 *
 * @module
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "./useSession";

/** A single tracked action in the universal shape returned by the RPC. */
export const trackedActionSchema = z.object({
  id: z.string().uuid(),
  /** The kind of action — reminder type, "dose", "check_in", "questionnaire", … */
  action_type: z.string(),
  /** When it happened (ISO timestamp). */
  occurred_at: z.string(),
  /** The reminder this was a reaction to, when applicable. */
  reminder_id: z.string().uuid().nullable(),
  /** The concrete source table behind the abstraction. */
  source: z.string(),
  source_id: z.string().uuid(),
  /** Source-shaped detail; consumers should treat keys as optional. */
  payload: z.record(z.string(), z.unknown()),
});

export type TrackedAction = z.infer<typeof trackedActionSchema>;

/** Options for {@link useTrackedActions}. */
export interface TrackedActionsOptions {
  /** ISO timestamp lower bound (inclusive). */
  since?: string;
  /** Restrict to a single `action_type`. */
  actionType?: string;
  /** Max rows (default 100). */
  limit?: number;
}

export const TRACKED_ACTIONS_QUERY_KEY = "tracked-actions";

/**
 * Fetch the current member's tracked actions in the universal shape.
 */
export function useTrackedActions(options: TrackedActionsOptions = {}) {
  const { user } = useSession();
  const { since, actionType, limit = 100 } = options;

  return useQuery({
    queryKey: [TRACKED_ACTIONS_QUERY_KEY, user?.id, since ?? null, actionType ?? null, limit],
    queryFn: async (): Promise<TrackedAction[]> => {
      const { data, error } = await aisha.rpc("get_my_tracked_actions", {
        p_action_type: actionType,
        p_limit: limit,
        p_since: since,
      });

      if (error) {
        safeError("useTrackedActions.rpcError", error);
        throw new Error(error.message);
      }

      const parsed = z.array(trackedActionSchema).safeParse(data ?? []);
      if (!parsed.success) {
        safeError("useTrackedActions.parse", parsed.error);
        return [];
      }
      return parsed.data;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
}
