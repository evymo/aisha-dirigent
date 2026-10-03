/**
 * @fileoverview Hook for managing IoT configuration per production flow node.
 *
 * Stores IoT entity mappings (Home Assistant entities, thresholds, reading types)
 * inside the flow node's `metadata.iot_config` JSON field. Uses the existing
 * `upsert_production_flow_node_admin` RPC under the hood.
 *
 * @example
 * const { iotConfig, updateIotConfig, isUpdating } = useFlowNodeIotConfig(nodeId, nodes);
 */
import { useCallback, useMemo } from "react";
import { z } from "zod";

import { useUpsertFlowNodeMutation, type FlowNode } from "./useAdminProductionFlow";

// ────────────────────── schemas ──────────────────────

/** Schema for a single IoT entity mapping on a flow node */
export const iotEntityMappingSchema = z.object({
  entity_id: z.string().min(1),
  label: z.string().min(1),
  max_threshold: z.number().nullable().optional(),
  min_threshold: z.number().nullable().optional(),
  reading_type: z.string().min(1),
  unit: z.string().min(1),
});

/** Schema for the entire IoT config stored in metadata.iot_config */
export const iotConfigSchema = z.object({
  entities: z.array(iotEntityMappingSchema).default([]),
  polling_interval_seconds: z.number().int().min(10).default(300),
  sync_enabled: z.boolean().default(false),
});

// ────────────────────── types ──────────────────────

export type IotEntityMapping = z.infer<typeof iotEntityMappingSchema>;
export type IotConfig = z.infer<typeof iotConfigSchema>;

const EMPTY_IOT_CONFIG: IotConfig = {
  entities: [],
  polling_interval_seconds: 300,
  sync_enabled: false,
};

// ────────────────────── hook ──────────────────────

/**
 * Reads and writes IoT configuration for a specific flow node.
 *
 * @param nodeId - UUID of the flow node (or undefined)
 * @param nodes - Array of all flow nodes (from useFlowNodesAdmin)
 * @returns iotConfig, updateIotConfig mutation wrapper, and loading state
 */
export function useFlowNodeIotConfig(
  nodeId: string | undefined,
  nodes: FlowNode[] | undefined,
) {
  const upsertMutation = useUpsertFlowNodeMutation();

  const node = useMemo(
    () => nodes?.find((n) => n.id === nodeId),
    [nodes, nodeId],
  );

  const iotConfig: IotConfig = useMemo(() => {
    if (!node?.metadata) return EMPTY_IOT_CONFIG;
    const raw = (node.metadata as Record<string, unknown>).iot_config;
    const parsed = iotConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : EMPTY_IOT_CONFIG;
  }, [node]);

  const updateIotConfig = useCallback(
    async (newConfig: IotConfig): Promise<void> => {
      if (!node) throw new Error("Node not found");

      const existingMeta = (node.metadata ?? {}) as Record<string, unknown>;

      await upsertMutation.mutateAsync({
        id: node.id,
        metadata: { ...existingMeta, iot_config: newConfig },
        node_code: node.node_code,
        node_name: node.node_name,
        node_type: node.node_type,
      });
    },
    [node, upsertMutation],
  );

  return {
    iotConfig,
    isUpdating: upsertMutation.isPending,
    node,
    updateIotConfig,
  };
}
