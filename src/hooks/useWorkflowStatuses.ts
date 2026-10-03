/**
 * useWorkflowStatuses — kanban lifecycle status lookup.
 *
 * Wraps the `list_workflow_statuses` RPC (a SECURITY DEFINER function that
 * reads from the workflow_statuses table). UI consumers should call
 * `t(status.label_i18n_key)` to render the human label — never render
 * `status.status` directly.
 *
 * The lookup is small (≤ 10 rows in practice) and rarely changes, so a
 * 5-minute staleTime is comfortably inside React Query's default GC window.
 *
 * @module hooks/useWorkflowStatuses
 */

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ============================================================================
// Schema
// ============================================================================

const WorkflowStatusRowSchema = z.object({
  status: z.string(),
  label_i18n_key: z.string(),
  sort_order: z.number().int(),
  swimlane_color: z.string().nullable(),
  is_terminal: z.boolean(),
  is_active: z.boolean(),
});

const WorkflowStatusArraySchema = z.array(WorkflowStatusRowSchema);

/** Single row from list_workflow_statuses. */
export type WorkflowStatus = z.infer<typeof WorkflowStatusRowSchema>;

// ============================================================================
// Hook
// ============================================================================

interface UseWorkflowStatusesOptions {
  /**
   * Include inactive statuses (for admin status manager). Defaults to false:
   * UI consumers typically want active-only.
   */
  includeInactive?: boolean;
  /** Disable the query (e.g. while another precondition resolves). */
  enabled?: boolean;
}

/**
 * Fetches kanban lifecycle statuses, ordered by sort_order ASC.
 *
 * @example
 * ```tsx
 * const { data: statuses = [] } = useWorkflowStatuses();
 * return statuses.map((s) => <SwimlaneHeader key={s.status} label={t(s.label_i18n_key)} />);
 * ```
 */
export function useWorkflowStatuses(opts: UseWorkflowStatusesOptions = {}) {
  const { includeInactive = false, enabled = true } = opts;

  return useQuery({
    queryKey: ["workflow_statuses", { includeInactive }],
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min — lookup rarely changes
    queryFn: async (): Promise<WorkflowStatus[]> => {
      const { data, error } = await aisha.rpc("list_workflow_statuses", {
        p_include_inactive: includeInactive,
      });

      if (error) {
        safeError("useWorkflowStatuses", error);
        throw error;
      }

      return WorkflowStatusArraySchema.parse(data ?? []);
    },
  });
}

/**
 * Convenience selector — returns a Map keyed by status code for O(1) lookup
 * inside render loops.
 */
export function useWorkflowStatusMap(opts: UseWorkflowStatusesOptions = {}) {
  const query = useWorkflowStatuses(opts);
  const map = new Map<string, WorkflowStatus>();
  for (const row of query.data ?? []) {
    map.set(row.status, row);
  }
  return { ...query, statusMap: map };
}
