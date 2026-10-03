/**
 * @fileoverview Hook for fetching protocol-specific sensor data per batch.
 *
 * Wraps `get_production_protocol_sensor_data_admin` RPC.
 * Returns aggregated sensor readings per flow node + reading type for a batch,
 * including excursion counts for IoT verification during protocol step completion.
 *
 * @example
 * const { data } = useProtocolSensorData(batchId);
 */
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { usePermissions } from "./usePermissions";

// ────────────────────── schema ──────────────────────

export const protocolSensorDataSchema = z.object({
  avg_value: z.number(),
  excursion_count: z.number(),
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

export type ProtocolSensorData = z.infer<typeof protocolSensorDataSchema>;

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
 * Fetches aggregated sensor data for a production batch.
 *
 * Used in protocol step completion dialogs to show IoT verification data
 * and excursion counts per flow node + reading type.
 *
 * @param batchId - Production batch ID (required)
 * @param filters - Optional flow_node_id and hours_back
 * @returns Query result with ProtocolSensorData[]
 */
export function useProtocolSensorData(
  batchId: string | null | undefined,
  filters?: {
    flow_node_id?: string;
    hours_back?: number;
  },
) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  return useQuery({
    enabled: canView && !!batchId,
    queryFn: async (): Promise<ProtocolSensorData[]> => {
      if (!canView || !batchId) return [];
      const { data, error } = await aisha.rpc(
        "get_production_protocol_sensor_data_admin",
        {
          p_batch_id: batchId,
          p_flow_node_id: filters?.flow_node_id ?? undefined,
          p_hours_back: filters?.hours_back ?? 168,
        },
      );
      if (error) {
        safeError("protocolSensorData.fetch", error);
        throw new Error(error.message);
      }
      return parseRpcArraySafe(protocolSensorDataSchema, data);
    },
    queryKey: ["admin-protocol-sensor-data", batchId, filters],
  });
}
