/**
 * useAllowedKanbanTransitions — per-story drag-drop validation.
 *
 * Wraps the `get_allowed_kanban_transitions` RPC. The kanban UI calls this
 * on hover/long-press to highlight only valid drop targets and gate the
 * drag-end mutation.
 *
 * Parallel to the delivery-side `get_allowed_transitions` RPC — same shape,
 * different domain (kanban vs delivery pipeline).
 *
 * @module hooks/useAllowedKanbanTransitions
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ============================================================================
// Schema
// ============================================================================

const TransitionRowSchema = z.object({
  to_status: z.string(),
  requires_role: z.string().nullable(),
});

const TransitionArraySchema = z.array(TransitionRowSchema);

/** A single legal drop target for the given story's current status. */
export type AllowedKanbanTransition = z.infer<typeof TransitionRowSchema>;

// ============================================================================
// Hook
// ============================================================================

interface UseAllowedKanbanTransitionsOptions {
  /** Story whose current status drives the transition lookup. */
  storyId: string | null | undefined;
  /** Disable the query (e.g. while storyId is loading). */
  enabled?: boolean;
}

/**
 * Returns the legal kanban transitions from the story's current status.
 *
 * @example
 * ```tsx
 * const { data: allowed = [] } = useAllowedKanbanTransitions({ storyId });
 * const allowedSet = new Set(allowed.map((t) => t.to_status));
 * return statuses.map((s) => (
 *   <Column key={s.status} dimmed={!allowedSet.has(s.status)} />
 * ));
 * ```
 */
export function useAllowedKanbanTransitions(
  opts: UseAllowedKanbanTransitionsOptions,
) {
  const { storyId, enabled = true } = opts;

  return useQuery({
    queryKey: ["kanban_transitions", storyId],
    enabled: enabled && !!storyId,
    staleTime: 30 * 1000, // 30s — current_status may change after a drag
    queryFn: async (): Promise<AllowedKanbanTransition[]> => {
      if (!storyId) return [];

      const { data, error } = await aisha.rpc("get_allowed_kanban_transitions", {
        p_story_id: storyId,
      });

      if (error) {
        safeError("useAllowedKanbanTransitions", error);
        throw error;
      }

      return TransitionArraySchema.parse(data ?? []);
    },
  });
}
