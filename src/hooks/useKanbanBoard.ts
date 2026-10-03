/**
 * useKanbanBoard — drives the mission-control kanban.
 *
 * Combines two RPCs:
 *   1. `kanban_stories_view` — read-side, one row per visible story with
 *      joined workflow_statuses + latest ai_run + last trace event.
 *      Wrapped by useLiveTable so realtime UPDATEs on partner_stories
 *      invalidate the cache + re-render columns.
 *   2. `update_story_status_audited` — write-side, exposed via
 *      `useMoveStoryStatus`. Transition validation lives in the RPC body
 *      (workflow_status_transitions); UI surfaces the resulting error.
 *
 * @module hooks/useKanbanBoard
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useLiveTable } from "@/hooks/useLiveTable";

// ============================================================================
// Schema
// ============================================================================

const KanbanRowSchema = z.object({
  story_id: z.string().uuid(),
  partner_id: z.string().uuid().nullable(),
  user_id: z.string().uuid().nullable(),
  is_stack_default: z.boolean(),
  title: z.string(),
  status: z.string(),
  status_label_i18n_key: z.string().nullable(),
  status_sort_order: z.number().int().nullable(),
  status_swimlane_color: z.string().nullable(),
  status_is_terminal: z.boolean(),
  priority: z.string(),
  is_starred: z.boolean(),
  last_activity_at: z.string(),
  default_branch: z.string().nullable(),
  latest_run_id: z.string().uuid().nullable(),
  current_agent_slug: z.string().nullable(),
  current_run_status: z.string().nullable(),
  last_event_at: z.string().nullable(),
  // Cost + budget surfacing (kanban_stories_view aggregate). numeric/bigint may
  // serialize as strings over PostgREST → coerce. cost/tokens are COALESCE'd to 0;
  // budget_* are NULL when no cap is set for the story.
  cost_to_date: z.coerce.number(),
  tokens_to_date: z.coerce.number(),
  budget_cost_limit: z.coerce.number().nullable(),
  budget_consumed: z.coerce.number().nullable(),
  budget_state: z.enum(["ok", "approaching", "stopped"]).nullable(),
});

const KanbanRowArraySchema = z.array(KanbanRowSchema);

/** One row of kanban_stories_view. */
export type KanbanStory = z.infer<typeof KanbanRowSchema>;

// ============================================================================
// Hooks
// ============================================================================

interface UseKanbanBoardOptions {
  /** Optional partner filter. NULL = all visible stories (per RLS). */
  partnerId?: string | null;
  /** Disable the query. */
  enabled?: boolean;
}

/**
 * Returns the live kanban story list (realtime-aware).
 *
 * Subscribes to `partner_stories` UPDATE events; whenever a status changes
 * the query is invalidated and the kanban re-fetches via kanban_stories_view.
 */
export function useKanbanBoard(opts: UseKanbanBoardOptions = {}) {
  const { partnerId = null, enabled = true } = opts;

  return useLiveTable<KanbanStory>({
    table: "partner_stories",
    queryKey: ["kanban_stories", partnerId ?? "*"],
    enabled,
    rpc: async (): Promise<KanbanStory[]> => {
      const { data, error } = await aisha.rpc("kanban_stories_view", {
        p_partner_id: partnerId ?? undefined,
      });
      if (error) {
        safeError("useKanbanBoard", error);
        throw error;
      }
      return KanbanRowArraySchema.parse(data ?? []);
    },
  });
}

interface MoveStoryStatusInput {
  storyId: string;
  toStatus: string;
}

/**
 * Mutation: move a story to a new kanban status. Wraps
 * `update_story_status_audited` which enforces:
 *   - ownership (partner OR member OR admin/staff)
 *   - legal transition via workflow_status_transitions
 *   - requires_role gating for terminal → inbox moves
 *   - audit_journal entry on success
 *
 * Invalidates the kanban_stories cache on success so the card snaps to
 * its new column without waiting for the realtime echo.
 */
export function useMoveStoryStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ storyId, toStatus }: MoveStoryStatusInput) => {
      const { data, error } = await aisha.rpc("update_story_status_audited", {
        p_status: toStatus,
        p_story_id: storyId,
      });
      if (error) {
        safeError("useMoveStoryStatus", error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kanban_stories"] });
      queryClient.invalidateQueries({ queryKey: ["story_detail"] });
    },
  });
}
