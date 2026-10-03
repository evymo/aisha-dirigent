/**
 * Hook for monitoring AI Runs and Trace Events (admin).
 *
 * Provides paginated list of runs and detail-level trace events.
 * Read-only — runs are created by the router pipeline, not the UI.
 * Uses RPC-only pattern with SECURITY DEFINER + is_admin_or_staff() checks.
 *
 * @module hooks/useAiRuns
 */

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import {
  aiRunArraySchema,
  aiTraceEventArraySchema,
  type AiRunRow,
  type AiTraceEventRow,
} from "@/lib/schemas/expertOverlaySchemas";

/** Query key factory for AI runs */
export const aiRunKeys = {
  all: ["ai-runs"] as const,
  list: (filters?: { status?: string; limit?: number; offset?: number }) =>
    [...aiRunKeys.all, "list", filters] as const,
  events: (runId: string | undefined) =>
    [...aiRunKeys.all, "events", runId] as const,
};

/**
 * Hook for fetching paginated AI runs.
 *
 * @param options - Optional filters: status, limit, offset.
 * @returns Query object with parsed run rows.
 * @example
 * const { data: runs } = useAiRuns({ status: "running", limit: 20 });
 */
export function useAiRuns(options?: {
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const status = options?.status ?? null;

  return useQuery({
    queryKey: aiRunKeys.list({ status: status ?? undefined, limit, offset }),
    queryFn: async (): Promise<AiRunRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc("get_ai_runs_admin", {
        p_limit: limit,
        p_offset: offset,
        p_status: status ?? undefined,
      });

      if (error) {
        safeError("useAiRuns.fetch", error);
        throw new Error(error.message);
      }

      return aiRunArraySchema.parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    staleTime: 10_000,
    refetchInterval: 30_000, // Auto-refresh for live monitoring
  });
}

/**
 * Hook for fetching trace events for a specific AI run.
 *
 * @param runId - UUID of the AI run to get events for.
 * @returns Query object with parsed trace event rows.
 * @example
 * const { data: events } = useAiRunEvents(selectedRunId);
 */
export function useAiRunEvents(runId: string | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: aiRunKeys.events(runId),
    queryFn: async (): Promise<AiTraceEventRow[]> => {
      if (!runId || !isAdmin) return [];

      const { data, error } = await aisha.rpc("get_ai_trace_events_admin", {
        p_run_id: runId,
      });

      if (error) {
        safeError("useAiRunEvents.fetch", error);
        throw new Error(error.message);
      }

      return aiTraceEventArraySchema.parse(data ?? []);
    },
    enabled: !!user && !!runId && isAdmin,
    staleTime: 5_000,
  });
}
