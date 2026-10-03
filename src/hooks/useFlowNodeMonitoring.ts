/**
 * @fileoverview Hook for fetching flow-node sensor monitoring data.
 *
 * Wraps `get_flow_node_sensor_summary_admin` RPC for real-time-ish
 * monitoring dashboard (auto-refetch every 30s by default).
 *
 * @example
 * const { data: summary } = useFlowNodeMonitoring({ hours_back: 4 });
 */
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { usePermissions } from "./usePermissions";

// ────────────────────── schema ──────────────────────

export const flowNodeSensorSummarySchema = z.object({
  avg_value: z.number(),
  flow_node_id: z.string().uuid(),
  has_excursion: z.boolean(),
  latest_recorded_at: z.string(),
  latest_unit: z.string(),
  latest_value: z.number(),
  max_value: z.number(),
  min_value: z.number(),
  node_code: z.string(),
  node_name: z.string(),
  reading_count: z.number(),
  reading_type: z.string(),
});

export type FlowNodeSensorSummary = z.infer<typeof flowNodeSensorSummarySchema>;

// ────────────────────── helper ──────────────────────

function parseRpcArraySafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): T[] {
  if (!data || !Array.isArray(data)) return [];
  const result: T[] = [];
  for (const item of data) {
    const parsed = schema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

// ────────────────────── hook ──────────────────────

/**
 * Fetches aggregated sensor summary per flow node + reading type.
 *
 * @param filters - Optional flow_node_id and hours_back
 * @param refetchIntervalMs - Auto-refetch interval in ms (default 30 000)
 * @returns Query result with FlowNodeSensorSummary[]
 */
export function useFlowNodeMonitoring(
  filters?: {
    flow_node_id?: string;
    hours_back?: number;
  },
  refetchIntervalMs = 30_000,
) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  return useQuery({
    enabled: canView,
    queryFn: async (): Promise<FlowNodeSensorSummary[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc(
        "get_flow_node_sensor_summary_admin",
        {
          p_flow_node_id: filters?.flow_node_id ?? undefined,
          p_hours_back: filters?.hours_back ?? 24,
        },
      );
      if (error) {
        safeError("flowNodeMonitoring.fetch", error);
        throw new Error(error.message);
      }
      return parseRpcArraySafe(flowNodeSensorSummarySchema, data);
    },
    queryKey: ["admin-flow-node-monitoring", filters],
    refetchInterval: refetchIntervalMs,
  });
}
