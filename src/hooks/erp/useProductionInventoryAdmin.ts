/**
 * @fileoverview Admin production inventory hooks — lots, inventory events, batch materials
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { usePermissions } from "../usePermissions";
import {
  parseRpcArraySafe,
  productionLotSchema,
  productionInventoryEventSchema,
  productionBatchMaterialSchema,
  type ProductionLot,
  type ProductionInventoryEvent,
  type ProductionBatchMaterial,
} from "./erpSchemas";

// ==================== Lots ====================

/**
 * Hook for fetching production lots (material lots/batches).
 *
 * @param filters - Optional filters for item_id, status, supplier_id
 * @returns Query result with production lots
 */
export function useProductionLotsAdmin(filters?: {
  item_id?: string;
  status?: string;
  supplier_id?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-lots", filters],
    queryFn: async (): Promise<ProductionLot[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_lots_admin", {
        p_item_id: filters?.item_id,
        p_status: filters?.status,
        p_supplier_id: filters?.supplier_id,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionLotSchema, data, "productionLots");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating production lots.
 *
 * @returns Mutation for upserting a production lot
 */
export function useUpsertProductionLotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lot: Partial<ProductionLot> & {
      lot_number: string;
      item_id: string;
    }) => {
      // Partial<DBRow>: coerce null → undefined for RPC arg compatibility.
      const { data, error } = await aisha.rpc("upsert_production_lot_admin", {
        p_batch_id: lot.batch_id ?? undefined,
        p_coa_document_id: lot.coa_document_id ?? undefined,
        p_expires_at: lot.expires_at ?? undefined,
        p_id: lot.id ?? undefined,
        p_item_id: lot.item_id,
        p_lot_number: lot.lot_number,
        p_manufactured_at: lot.manufactured_at ?? undefined,
        p_metadata: (lot.metadata ?? undefined) as Json | undefined,
        p_notes: lot.notes ?? undefined,
        p_quantity: lot.quantity ?? undefined,
        p_received_at: lot.received_at ?? undefined,
        p_remaining_quantity: lot.remaining_quantity ?? undefined,
        p_status: lot.status ?? "quarantine",
        p_storage_location_id: lot.storage_location_id ?? undefined,
        p_supplier_id: lot.supplier_id ?? undefined,
        p_supplier_lot: lot.supplier_lot ?? undefined,
        p_uom: lot.uom ?? "kg",
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-lots"] });
    },
  });
}

// ==================== Inventory Events ====================

/**
 * Hook for fetching production inventory events (immutable stock movements).
 *
 * @param filters - Optional filters for event_type, location_id, lot_id
 * @returns Query result with inventory events
 */
export function useProductionInventoryEventsAdmin(filters?: {
  event_type?: string;
  location_id?: string;
  lot_id?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-inventory-events", filters],
    queryFn: async (): Promise<ProductionInventoryEvent[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_inventory_events_admin", {
        p_event_type: filters?.event_type,
        p_location_id: filters?.location_id,
        p_lot_id: filters?.lot_id,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionInventoryEventSchema, data, "productionInventoryEvents");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating production inventory events (immutable — no update).
 *
 * @returns Mutation for creating an inventory event
 */
export function useCreateProductionInventoryEventMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (event: {
      event_type: string;
      lot_id: string;
      quantity: number;
      location_id?: string;
      metadata?: Json;
      reason?: string;
      ref_id?: string;
      ref_type?: string;
      uom?: string;
    }) => {
      const { data, error } = await aisha.rpc("create_production_inventory_event_admin", {
        p_event_type: event.event_type,
        p_location_id: event.location_id,
        p_lot_id: event.lot_id,
        p_metadata: event.metadata,
        p_quantity: event.quantity,
        p_reason: event.reason,
        p_ref_id: event.ref_id,
        p_ref_type: event.ref_type,
        p_uom: event.uom ?? "kg",
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-inventory-events"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-production-lots"] });
    },
  });
}

// ==================== Batch Materials ====================

/**
 * Hook for fetching production batch materials (BOM consumption/production).
 *
 * @param filters - Optional filters for batch_id, direction
 * @returns Query result with batch materials
 */
export function useProductionBatchMaterialsAdmin(filters?: {
  batch_id?: string;
  direction?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-batch-materials", filters],
    queryFn: async (): Promise<ProductionBatchMaterial[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_batch_materials_admin", {
        p_batch_id: filters?.batch_id,
        p_direction: filters?.direction,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionBatchMaterialSchema, data, "productionBatchMaterials");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating batch material records.
 *
 * @returns Mutation for upserting a batch material
 */
export function useUpsertProductionBatchMaterialMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (material: Partial<ProductionBatchMaterial> & {
      batch_id: string;
      item_id: string;
    }) => {
      // Partial<DBRow>: coerce null → undefined for RPC arg compatibility.
      const { data, error } = await aisha.rpc("upsert_production_batch_material_admin", {
        p_actual_qty: material.actual_qty ?? undefined,
        p_batch_id: material.batch_id,
        p_direction: material.direction ?? "IN",
        p_id: material.id ?? undefined,
        p_item_id: material.item_id,
        p_lot_id: material.lot_id ?? undefined,
        p_metadata: (material.metadata ?? undefined) as Json | undefined,
        p_notes: material.notes ?? undefined,
        p_planned_qty: material.planned_qty ?? undefined,
        p_step_id: material.step_id ?? undefined,
        p_uom: material.uom ?? "kg",
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-batch-materials"] });
    },
  });
}
