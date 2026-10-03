/**
 * @fileoverview Admin production flow tracking hooks
 * Provides React Query hooks for substance flow tracking:
 * nodes, records, substances, balance computation, and inventory.
 * All hooks use RPC functions for secure, audited database access.
 *
 * This module covers universal material tracking — every substance
 * (ethanol, water, extracts, intermediates) flows through a directed
 * graph of typed nodes (supplier → storage → process → finished/waste).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { usePermissions } from "./usePermissions";
import { z } from "zod";

// ==================== Schemas ====================

const flowNodeSchema = z.object({
  id: z.string().uuid(),
  node_code: z.string(),
  node_name: z.string(),
  node_type: z.string(),
  location_id: z.string().uuid().nullable(),
  supplier_id: z.string().uuid().nullable(),
  equipment_id: z.string().uuid().nullable(),
  capacity_l: z.number().nullable(),
  default_concentration_pct: z.number().nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
});

const flowRecordSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid().nullable(),
  substance_id: z.string().uuid().nullable(),
  source_node_id: z.string().uuid().nullable(),
  target_node_id: z.string().uuid().nullable(),
  flow_date: z.string(),
  volume_l: z.number(),
  concentration_pct: z.number(),
  pure_amount_l: z.number(),
  temperature_c: z.number().nullable(),
  lot_id: z.string().uuid().nullable(),
  responsible_user_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  is_correction: z.boolean().optional(),
  corrects_record_id: z.string().uuid().nullable().optional(),
  correction_reason: z.string().nullable().optional(),
  is_storno: z.boolean().optional(),
});

const flowSubstanceSchema = z.object({
  id: z.string().uuid(),
  substance_code: z.string(),
  substance_name: z.string(),
  cas_number: z.string().nullable(),
  density_kg_l: z.number().nullable(),
  regulatory_class: z.string().nullable(),
  default_unit: z.string().nullable(),
  default_concentration_pct: z.number().nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
});

const flowBalanceSchema = z.object({
  node_id: z.string().uuid(),
  node_code: z.string(),
  node_name: z.string(),
  node_type: z.string(),
  total_received_volume_l: z.number(),
  total_received_pure_l: z.number(),
  total_dispatched_volume_l: z.number(),
  total_dispatched_pure_l: z.number(),
  balance_volume_l: z.number(),
  balance_pure_l: z.number(),
  avg_concentration_pct: z.number(),
  record_count: z.number(),
});

const flowNodeInventorySchema = z.object({
  node_id: z.string().uuid(),
  node_code: z.string(),
  node_name: z.string(),
  node_type: z.string(),
  current_volume_l: z.number(),
  current_pure_l: z.number(),
  avg_concentration_pct: z.number(),
  last_flow_date: z.string().nullable(),
  total_records: z.number(),
});

// ==================== Types ====================

export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowRecord = z.infer<typeof flowRecordSchema>;
export type FlowSubstance = z.infer<typeof flowSubstanceSchema>;
export type FlowBalance = z.infer<typeof flowBalanceSchema>;
export type FlowNodeInventory = z.infer<typeof flowNodeInventorySchema>;

/** Node type enum matching the DB CHECK constraint */
export const FLOW_NODE_TYPES = [
  "supplier",
  "storage",
  "process",
  "regeneration",
  "finished",
  "waste",
] as const;
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

// ==================== Helper ====================

function parseRpcArraySafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  _label: string,
): T[] {
  if (!data || !Array.isArray(data)) return [];
  const result: T[] = [];
  for (const item of data) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      result.push(parsed.data);
    }
  }
  return result;
}

// ==================== Flow Nodes ====================

/**
 * Hook for fetching production flow nodes (graph vertices).
 *
 * @param filters - Optional filters for active status and node type
 * @returns Query result with flow nodes
 * @example
 * const { data: nodes } = useFlowNodesAdmin({ node_type: "storage" });
 */
export function useFlowNodesAdmin(filters?: {
  is_active?: boolean;
  node_type?: FlowNodeType;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-flow-nodes", filters],
    queryFn: async (): Promise<FlowNode[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc(
        "get_production_flow_nodes_admin",
        {
          p_is_active: filters?.is_active,
          p_node_type: filters?.node_type,
        },
      );
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(flowNodeSchema, data, "flowNodes");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating flow nodes.
 *
 * @returns Mutation for upserting a flow node
 */
export function useUpsertFlowNodeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      node: Partial<FlowNode> & {
        node_code: string;
        node_name: string;
      },
    ) => {
      // Partial<DBRow> fields are `T | null | undefined`; RPC args are
      // `T | undefined`. Coerce null → undefined so PostgREST omits the
      // field (SQL DEFAULT applies, which is NULL).
      const { data, error } = await aisha.rpc(
        "upsert_production_flow_node_admin",
        {
          p_capacity_l: node.capacity_l ?? undefined,
          p_default_concentration_pct: node.default_concentration_pct ?? undefined,
          p_equipment_id: node.equipment_id ?? undefined,
          p_id: node.id ?? undefined,
          p_is_active: node.is_active ?? true,
          p_location_id: node.location_id ?? undefined,
          p_metadata: (node.metadata ?? undefined) as Json | undefined,
          p_node_code: node.node_code,
          p_node_name: node.node_name,
          p_node_type: node.node_type ?? "storage",
          p_notes: node.notes ?? undefined,
          p_supplier_id: node.supplier_id ?? undefined,
        },
      );
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-flow-nodes"] });
    },
  });
}

// ==================== Flow Substances ====================

/**
 * Hook for fetching flow substances (tracked materials master data).
 *
 * @param filters - Optional filters for active status and regulatory class
 * @returns Query result with flow substances
 * @example
 * const { data: substances } = useFlowSubstancesAdmin({ regulatory_class: "excise" });
 */
export function useFlowSubstancesAdmin(filters?: {
  is_active?: boolean;
  regulatory_class?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-flow-substances", filters],
    queryFn: async (): Promise<FlowSubstance[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc(
        "get_production_flow_substances_admin",
        {
          p_is_active: filters?.is_active,
          p_regulatory_class: filters?.regulatory_class,
        },
      );
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(flowSubstanceSchema, data, "flowSubstances");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating flow substances.
 *
 * @returns Mutation for upserting a flow substance
 */
export function useUpsertFlowSubstanceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      substance: Partial<FlowSubstance> & {
        substance_code: string;
        substance_name: string;
      },
    ) => {
      // Partial<DBRow> fields: see comment on useUpsertFlowNodeMutation.
      const { data, error } = await aisha.rpc(
        "upsert_production_flow_substance_admin",
        {
          p_cas_number: substance.cas_number ?? undefined,
          p_default_concentration_pct: substance.default_concentration_pct ?? 100,
          p_default_unit: substance.default_unit ?? "l",
          p_density_kg_l: substance.density_kg_l ?? undefined,
          p_id: substance.id ?? undefined,
          p_is_active: substance.is_active ?? true,
          p_metadata: (substance.metadata ?? undefined) as Json | undefined,
          p_notes: substance.notes ?? undefined,
          p_regulatory_class: substance.regulatory_class ?? undefined,
          p_substance_code: substance.substance_code,
          p_substance_name: substance.substance_name,
        },
      );
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin-flow-substances"],
      });
    },
  });
}

// ==================== Flow Records ====================

/**
 * Hook for fetching flow records (immutable substance movements).
 *
 * @param filters - Optional filters for batch, substance, source/target node
 * @returns Query result with flow records
 * @example
 * const { data: records } = useFlowRecordsAdmin({ batch_id: "..." });
 */
export function useFlowRecordsAdmin(filters?: {
  batch_id?: string;
  limit?: number;
  offset?: number;
  source_node_id?: string;
  substance_id?: string;
  target_node_id?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-flow-records", filters],
    queryFn: async (): Promise<FlowRecord[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc(
        "get_production_flow_records_admin",
        {
          p_batch_id: filters?.batch_id,
          p_limit: filters?.limit ?? 200,
          p_offset: filters?.offset ?? 0,
          p_source_node_id: filters?.source_node_id,
          p_substance_id: filters?.substance_id,
          p_target_node_id: filters?.target_node_id,
        },
      );
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(flowRecordSchema, data, "flowRecords");
    },
    enabled: canView,
  });
}

/**
 * Hook for resolving the latest known batch linked to a specific flow node.
 * Searches both source and target usage of the node and returns an auto-fill suggestion
 * only when the node has a single unambiguous batch candidate.
 *
 * @param flowNodeId - Flow node UUID.
 * @returns Query result with suggested batch and candidate count.
 */
export function useLatestBatchForFlowNodeAdmin(flowNodeId?: string) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-flow-node-latest-batch", flowNodeId],
    queryFn: async (): Promise<{ candidateCount: number; suggestedBatchId: string | null }> => {
      if (!flowNodeId) {
        return {
          candidateCount: 0,
          suggestedBatchId: null,
        };
      }

      // Omit unset filter params (PostgREST applies SQL DEFAULT NULL).
      const [sourceResponse, targetResponse] = await Promise.all([
        aisha.rpc("get_production_flow_records_admin", {
          p_limit: 120,
          p_offset: 0,
          p_source_node_id: flowNodeId,
        }),
        aisha.rpc("get_production_flow_records_admin", {
          p_limit: 120,
          p_offset: 0,
          p_target_node_id: flowNodeId,
        }),
      ]);

      if (sourceResponse.error) throw sourceResponse.error;
      if (targetResponse.error) throw targetResponse.error;

      const sourceRecords = parseRpcArraySafe(flowRecordSchema, sourceResponse.data, "flowRecordsSource");
      const targetRecords = parseRpcArraySafe(flowRecordSchema, targetResponse.data, "flowRecordsTarget");
      const orderedBatchIds = [...sourceRecords, ...targetRecords]
        .filter((record) => record.batch_id != null)
        .sort((first, second) => {
          const secondFlowDate = new Date(second.flow_date).getTime();
          const firstFlowDate = new Date(first.flow_date).getTime();
          if (secondFlowDate !== firstFlowDate) {
            return secondFlowDate - firstFlowDate;
          }

          return new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
        })
        .map((record) => record.batch_id)
        .filter((batchId): batchId is string => Boolean(batchId));

      const uniqueBatchIds: string[] = [];
      const seenBatchIds = new Set<string>();
      for (const batchId of orderedBatchIds) {
        if (seenBatchIds.has(batchId)) continue;
        seenBatchIds.add(batchId);
        uniqueBatchIds.push(batchId);
      }

      return {
        candidateCount: uniqueBatchIds.length,
        suggestedBatchId: uniqueBatchIds.length === 1 ? uniqueBatchIds[0] : null,
      };
    },
    enabled: canView && Boolean(flowNodeId),
  });
}

/**
 * Mutation hook for creating an immutable flow record.
 * Records cannot be updated or deleted — they are regulatory-immutable.
 *
 * @returns Mutation for creating a flow record
 */
export function useCreateFlowRecordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (record: {
      batch_id: string;
      concentration_pct: number;
      flow_date?: string;
      lot_id?: string;
      metadata?: Json;
      notes?: string;
      source_node_id: string;
      substance_id: string;
      target_node_id: string;
      temperature_c?: number;
      volume_l: number;
    }) => {
      const { data, error } = await aisha.rpc(
        "create_production_flow_record_admin",
        {
          p_batch_id: record.batch_id,
          p_concentration_pct: record.concentration_pct,
          p_flow_date: record.flow_date ?? new Date().toISOString(),
          p_lot_id: record.lot_id,
          p_metadata: record.metadata,
          p_notes: record.notes,
          p_source_node_id: record.source_node_id,
          p_substance_id: record.substance_id,
          p_target_node_id: record.target_node_id,
          p_temperature_c: record.temperature_c,
          p_volume_l: record.volume_l,
        },
      );
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-flow-records"] });
      queryClient.invalidateQueries({ queryKey: ["admin-flow-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["admin-flow-node-inventory"],
      });
    },
  });
}

// ==================== Flow Balance ====================

/**
 * Hook for computing substance balance per batch.
 * Returns per-node received/dispatched/balance volumes and avg concentration.
 *
 * @param params - Batch ID and substance ID (both required)
 * @returns Query result with flow balance data
 * @example
 * const { data: balance } = useFlowBalanceAdmin({ batch_id: "...", substance_id: "..." });
 */
export function useFlowBalanceAdmin(params: {
  batch_id: string | undefined;
  substance_id: string | undefined;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  const enabled = canView && !!params.batch_id && !!params.substance_id;
  return useQuery({
    queryKey: ["admin-flow-balance", params.batch_id, params.substance_id],
    queryFn: async (): Promise<FlowBalance[]> => {
      if (!params.batch_id || !params.substance_id) return [];
      const { data, error } = await aisha.rpc(
        "compute_production_flow_balance_admin",
        {
          p_batch_id: params.batch_id,
          p_substance_id: params.substance_id,
        },
      );
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(flowBalanceSchema, data, "flowBalance");
    },
    enabled,
  });
}

// ==================== Flow Node Inventory ====================

/**
 * Hook for current inventory state per node for a given substance.
 * Shows current volume, average concentration, pure amount, and last flow date.
 *
 * @param params - Substance ID (required), optional batch and node filter
 * @returns Query result with node inventory data
 * @example
 * const { data: inventory } = useFlowNodeInventoryAdmin({ substance_id: "..." });
 */
export function useFlowNodeInventoryAdmin(params: {
  batch_id?: string;
  node_id?: string;
  substance_id: string | undefined;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  const enabled = canView && !!params.substance_id;
  return useQuery({
    queryKey: [
      "admin-flow-node-inventory",
      params.substance_id,
      params.batch_id,
      params.node_id,
    ],
    queryFn: async (): Promise<FlowNodeInventory[]> => {
      if (!params.substance_id) return [];
      const { data, error } = await aisha.rpc(
        "get_production_flow_node_inventory_admin",
        {
          p_batch_id: params.batch_id,
          p_node_id: params.node_id,
          p_substance_id: params.substance_id,
        },
      );
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(
        flowNodeInventorySchema,
        data,
        "flowNodeInventory",
      );
    },
    enabled,
  });
}

// ==================== Batch Flow Duplication ====================

/**
 * Mutation hook for duplicating all flow records from one batch to another.
 * Creates new immutable records with the target batch ID,
 * preserving substance, nodes, volumes, and concentrations.
 *
 * @returns Mutation for duplicating flow records between batches
 * @example
 * const dup = useDuplicateBatchFlowMutation();
 * dup.mutate({ source_batch_id: "...", target_batch_id: "..." });
 */
export function useDuplicateBatchFlowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      source_batch_id: string;
      target_batch_id: string;
    }) => {
      // Fetch source records (omit unset filters — PostgREST uses SQL DEFAULT NULL).
      const { data: sourceRecords, error: fetchError } = await aisha.rpc(
        "get_production_flow_records_admin",
        {
          p_batch_id: params.source_batch_id,
          p_limit: 1000,
          p_offset: 0,
        },
      );
      if (fetchError) throw fetchError;
      const records = parseRpcArraySafe(
        flowRecordSchema,
        sourceRecords,
        "duplicateSource",
      );
      if (records.length === 0) {
        throw new Error("NO_RECORDS");
      }
      // Create duplicated records in the target batch
      let created = 0;
      for (const r of records) {
        // Records come from DBRow shape with `T | null` fields; RPC args
        // are `T | undefined`. Coerce null → undefined per project pattern.
        const { error: createError } = await aisha.rpc(
          "create_production_flow_record_admin",
          {
            p_batch_id: params.target_batch_id,
            p_concentration_pct: r.concentration_pct,
            p_flow_date: new Date().toISOString(),
            p_lot_id: r.lot_id ?? undefined,
            p_metadata: (r.metadata ?? undefined) as Json | undefined,
            p_notes: r.notes ?? undefined,
            p_source_node_id: r.source_node_id ?? undefined,
            p_substance_id: r.substance_id ?? undefined,
            p_target_node_id: r.target_node_id ?? undefined,
            p_temperature_c: r.temperature_c ?? undefined,
            p_volume_l: r.volume_l,
          },
        );
        if (createError) throw createError;
        created++;
      }
      return { created, total: records.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-flow-records"] });
      queryClient.invalidateQueries({ queryKey: ["admin-flow-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["admin-flow-node-inventory"],
      });
    },
  });
}
