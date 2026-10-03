/**
 * @fileoverview Admin production master data hooks — suppliers, locations, equipment
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { usePermissions } from "../usePermissions";
import {
  parseRpcArraySafe,
  productionSupplierSchema,
  productionLocationSchema,
  productionEquipmentSchema,
  type ProductionSupplier,
  type ProductionLocation,
  type ProductionEquipment,
} from "./erpSchemas";

// ==================== Suppliers ====================

/**
 * Hook for fetching production suppliers (master data).
 *
 * @param filters - Optional filters for qualification_status and risk_level
 * @returns Query result with production suppliers
 * @example
 * const { data: suppliers } = useProductionSuppliersAdmin({ qualification_status: "qualified" });
 */
export function useProductionSuppliersAdmin(filters?: {
  qualification_status?: string;
  risk_level?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-suppliers", filters],
    queryFn: async (): Promise<ProductionSupplier[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_suppliers_admin", {
        p_qualification_status: filters?.qualification_status,
        p_risk_level: filters?.risk_level,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionSupplierSchema, data, "productionSuppliers");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating production suppliers.
 *
 * @returns Mutation for upserting a production supplier
 */
export function useUpsertProductionSupplierMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (supplier: Partial<ProductionSupplier> & {
      supplier_code: string;
      supplier_name: string;
    }) => {
      // Partial<DBRow> fields are `T | null | undefined`; RPC args are
      // `T | undefined`. Coerce null → undefined.
      const { data, error } = await aisha.rpc("upsert_production_supplier_admin", {
        p_approved_by: supplier.approved_by ?? undefined,
        p_certificates: (supplier.certificates ?? undefined) as Json | undefined,
        p_contacts: (supplier.contacts ?? undefined) as Json | undefined,
        p_country: supplier.country ?? undefined,
        p_id: supplier.id ?? undefined,
        p_is_active: supplier.is_active ?? true,
        p_metadata: (supplier.metadata ?? undefined) as Json | undefined,
        p_notes: supplier.notes ?? undefined,
        p_qualification_status: supplier.qualification_status ?? "pending",
        p_risk_level: supplier.risk_level ?? "medium",
        p_supplier_code: supplier.supplier_code,
        p_supplier_name: supplier.supplier_name,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-suppliers"] });
    },
  });
}

// ==================== Locations ====================

/**
 * Hook for fetching production locations.
 *
 * @param filters - Optional filter for location_type
 * @returns Query result with production locations
 */
export function useProductionLocationsAdmin(filters?: {
  location_type?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-locations", filters],
    queryFn: async (): Promise<ProductionLocation[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_locations_admin", {
        p_location_type: filters?.location_type,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionLocationSchema, data, "productionLocations");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating production locations.
 *
 * @returns Mutation for upserting a production location
 */
export function useUpsertProductionLocationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (location: Partial<ProductionLocation> & {
      location_code: string;
      location_name: string;
    }) => {
      // Partial<DBRow>: coerce null → undefined for RPC arg compatibility.
      const { data, error } = await aisha.rpc("upsert_production_location_admin", {
        p_address: ((location as { address?: unknown }).address ?? undefined) as Json | undefined,
        p_gmp_zone: location.gmp_zone ?? undefined,
        p_humidity_range_max: location.humidity_range_max ?? undefined,
        p_humidity_range_min: location.humidity_range_min ?? undefined,
        p_id: location.id ?? undefined,
        p_is_active: location.is_active ?? true,
        p_location_code: location.location_code,
        p_location_name: location.location_name,
        p_location_type: location.location_type ?? "plant",
        p_metadata: (location.metadata ?? undefined) as Json | undefined,
        p_notes: location.notes ?? undefined,
        p_parent_location_id: location.parent_location_id ?? undefined,
        p_temp_range_max: location.temp_range_max ?? undefined,
        p_temp_range_min: location.temp_range_min ?? undefined,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-locations"] });
    },
  });
}

// ==================== Equipment ====================

/**
 * Hook for fetching production equipment.
 *
 * @param filters - Optional filters for gmp_criticality, location_id, qualification_status
 * @returns Query result with production equipment
 */
export function useProductionEquipmentAdmin(filters?: {
  gmp_criticality?: string;
  location_id?: string;
  qualification_status?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-equipment", filters],
    queryFn: async (): Promise<ProductionEquipment[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_equipment_admin", {
        p_gmp_criticality: filters?.gmp_criticality,
        p_location_id: filters?.location_id,
        p_qualification_status: filters?.qualification_status,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionEquipmentSchema, data, "productionEquipment");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating production equipment.
 *
 * @returns Mutation for upserting production equipment
 */
export function useUpsertProductionEquipmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (equipment: Partial<ProductionEquipment> & {
      asset_tag: string;
      equipment_name: string;
    }) => {
      // Partial<DBRow>: coerce null → undefined for RPC arg compatibility.
      const { data, error } = await aisha.rpc("upsert_production_equipment_admin", {
        p_asset_tag: equipment.asset_tag,
        p_equipment_name: equipment.equipment_name,
        p_gmp_criticality: equipment.gmp_criticality ?? "standard",
        p_id: equipment.id ?? undefined,
        p_is_active: equipment.is_active ?? true,
        p_location_id: equipment.location_id ?? undefined,
        p_manufacturer: equipment.manufacturer ?? undefined,
        p_metadata: (equipment.metadata ?? undefined) as Json | undefined,
        p_model: equipment.model ?? undefined,
        p_next_qualification_due: equipment.next_qualification_due ?? undefined,
        p_notes: equipment.notes ?? undefined,
        p_power_kw: equipment.power_kw ?? undefined,
        p_qualification_status: equipment.qualification_status ?? "pending",
        p_resource_id: equipment.resource_id ?? undefined,
        p_serial_no: equipment.serial_no ?? undefined,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-equipment"] });
    },
  });
}
