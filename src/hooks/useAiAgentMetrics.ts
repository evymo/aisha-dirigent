/**
 * Hook for AI Agent Metrics & Observability (admin).
 *
 * Provides:
 * - Agent-level metrics summary (total events, latency, cost, error rate)
 * - Hourly timeseries data for charting
 * - Run summary (totals by status/kind, avg duration)
 * - Mutation to refresh the materialized view
 *
 * All RPCs require admin/staff role (SECURITY DEFINER + is_admin_or_staff()).
 * Uses RPC-only pattern — never calls `.from()`.
 *
 * @module hooks/useAiAgentMetrics
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import {
  agentMetricsSummaryArraySchema,
  agentMetricsTimeseriesArraySchema,
  aiRunSummarySchema,
  type AgentMetricsSummaryRow,
  type AgentMetricsTimeseriesRow,
  type AiRunSummary,
} from "@/lib/schemas/expertOverlaySchemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

/** Query key factory for AI agent metrics */
export const aiAgentMetricsKeys = {
  all: ["ai-agent-metrics"] as const,
  summary: (hoursBack?: number, agentSlug?: string) =>
    [...aiAgentMetricsKeys.all, "summary", hoursBack, agentSlug] as const,
  timeseries: (hoursBack?: number, agentSlug?: string) =>
    [...aiAgentMetricsKeys.all, "timeseries", hoursBack, agentSlug] as const,
  runSummary: (hoursBack?: number) =>
    [...aiAgentMetricsKeys.all, "run-summary", hoursBack] as const,
};

// ---------------------------------------------------------------------------
// useAiAgentMetrics — summary per agent
// ---------------------------------------------------------------------------

/**
 * Hook for fetching agent-level metrics summary.
 *
 * @param options - hoursBack (default 168h = 7 days), agentSlug (optional filter)
 * @returns Query with parsed AgentMetricsSummaryRow array.
 * @example
 * const { data: metrics } = useAiAgentMetrics({ hoursBack: 48 });
 */
export function useAiAgentMetrics(options?: {
  hoursBack?: number;
  agentSlug?: string;
}) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const hoursBack = options?.hoursBack ?? 168;
  const agentSlug = options?.agentSlug ?? undefined;

  return useQuery({
    queryKey: aiAgentMetricsKeys.summary(hoursBack, agentSlug),
    queryFn: async (): Promise<AgentMetricsSummaryRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc("get_ai_agent_metrics", {
        p_agent_slug: agentSlug ?? undefined,
      
        p_hours_back: hoursBack,});

      if (error) {
        safeError("useAiAgentMetrics.summary", error);
        throw new Error(error.message);
      }

      // RPC returns JSONB — parse as array
      const raw = Array.isArray(data) ? data : [];
      return agentMetricsSummaryArraySchema.parse(raw);
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useAiAgentMetricsTimeseries — hourly data for charts
// ---------------------------------------------------------------------------

/**
 * Hook for fetching hourly timeseries data per agent.
 *
 * @param options - hoursBack, agentSlug
 * @returns Query with parsed timeseries rows.
 * @example
 * const { data: series } = useAiAgentMetricsTimeseries({ hoursBack: 24 });
 */
export function useAiAgentMetricsTimeseries(options?: {
  hoursBack?: number;
  agentSlug?: string;
}) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const hoursBack = options?.hoursBack ?? 168;
  const agentSlug = options?.agentSlug ?? undefined;

  return useQuery({
    queryKey: aiAgentMetricsKeys.timeseries(hoursBack, agentSlug),
    queryFn: async (): Promise<AgentMetricsTimeseriesRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc(
        "get_ai_agent_metrics_timeseries",
        {
          p_agent_slug: agentSlug ?? undefined,
        
          p_hours_back: hoursBack,},
      );

      if (error) {
        safeError("useAiAgentMetrics.timeseries", error);
        throw new Error(error.message);
      }

      const raw = Array.isArray(data) ? data : [];
      return agentMetricsTimeseriesArraySchema.parse(raw);
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useAiRunSummary — aggregated run statistics
// ---------------------------------------------------------------------------

/**
 * Hook for fetching aggregated run summary (totals, by_status, by_kind, avg_duration).
 *
 * @param options - hoursBack (default 168)
 * @returns Query with parsed AiRunSummary object.
 * @example
 * const { data: summary } = useAiRunSummary({ hoursBack: 24 });
 */
export function useAiRunSummary(options?: { hoursBack?: number }) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  const hoursBack = options?.hoursBack ?? 168;

  return useQuery({
    queryKey: aiAgentMetricsKeys.runSummary(hoursBack),
    queryFn: async (): Promise<AiRunSummary> => {
      if (!isAdmin) {
        return { total_runs: 0, by_status: {}, by_kind: {}, avg_duration_ms: null };
      }

      const { data, error } = await aisha.rpc("get_ai_run_summary", {
        p_hours_back: hoursBack,
      });

      if (error) {
        safeError("useAiRunSummary.fetch", error);
        throw new Error(error.message);
      }

      // RPC returns JSONB — parse as object
      const raw = typeof data === "object" && data !== null ? data : {};
      return aiRunSummarySchema.parse(raw);
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useRefreshAiAgentMetrics — mutation to refresh materialized view
// ---------------------------------------------------------------------------

/**
 * Mutation to refresh the ai_agent_metrics_hourly materialized view.
 * Only admin/staff can invoke.
 *
 * @example
 * const { mutate: refresh } = useRefreshAiAgentMetrics();
 * refresh();
 */
export function useRefreshAiAgentMetrics() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await aisha.rpc("refresh_ai_agent_metrics");

      if (error) {
        safeError("useRefreshAiAgentMetrics", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      // Invalidate all metrics queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: aiAgentMetricsKeys.all });
    },
  });
}
