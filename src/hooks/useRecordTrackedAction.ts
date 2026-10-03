/**
 * useRecordTrackedAction — the write side of the tracked_action surface. Records
 * an ad-hoc "the user did / reacted to something" event via record_tracked_action;
 * it then surfaces through useTrackedActions like any other source. Rich domain
 * events (a dose, a check-in) keep their specialized flows.
 *
 * @module
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { TRACKED_ACTIONS_QUERY_KEY } from "./useTrackedActions";

import type { Json } from "@/integrations/db/types";

/** Input for recording a tracked action. Only `actionType` is required. */
export interface RecordTrackedActionInput {
  actionType: string;
  payload?: Json;
  /** Optional reminder this action fulfils (must belong to the caller). */
  reminderId?: string;
  /** ISO timestamp; defaults to now server-side. */
  occurredAt?: string;
}

/** Records a tracked action and invalidates the tracked-actions cache. */
export function useRecordTrackedAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordTrackedActionInput): Promise<string> => {
      const { data, error } = await aisha.rpc("record_tracked_action", {
        p_action_type: input.actionType,
        p_occurred_at: input.occurredAt,
        p_payload: input.payload ?? {},
        p_reminder_id: input.reminderId,
      });
      if (error) {
        safeError("useRecordTrackedAction", error);
        throw new Error(error.message);
      }
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TRACKED_ACTIONS_QUERY_KEY] });
    },
  });
}
