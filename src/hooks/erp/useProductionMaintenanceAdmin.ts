/**
 * @fileoverview Admin production maintenance hooks — calibrations, cleaning, QC test definitions, sensor readings
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { usePermissions } from "../usePermissions";
import {
  parseRpcArraySafe,
  productionEquipmentCalibrationSchema,
  productionEquipmentCleaningSchema,
  productionQcTestDefinitionSchema,
  productionSensorReadingSchema,
  type ProductionEquipmentCalibration,
  type ProductionEquipmentCleaning,
  type ProductionQcTestDefinition,
  type ProductionSensorReading,
} from "./erpSchemas";

// ==================== Equipment Calibrations ====================

/**
 * Hook for fetching equipment calibration records.
 *
 * @param filters - Optional filters for equipment_id, result
 * @returns Query result with calibration records
 */
export function useProductionEquipmentCalibrationsAdmin(filters?: {
  equipment_id?: string;
  result?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-equipment-calibrations", filters],
    queryFn: async (): Promise<ProductionEquipmentCalibration[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_equipment_calibrations_admin", {
        p_equipment_id: filters?.equipment_id,
        p_result: filters?.result,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionEquipmentCalibrationSchema, data, "productionCalibrations");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating calibration records (immutable — no update).
 *
 * @returns Mutation for creating a calibration record
 */
export function useCreateProductionEquipmentCalibrationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (calibration: {
      calibration_type: string;
      equipment_id: string;
      adjustment_made?: boolean;
      certificate_doc_id?: string;
      deviation_found?: number;
      deviation_limit?: number;
      metadata?: Json;
      next_due_at?: string;
      notes?: string;
      performed_at?: string;
      reference_standard?: string;
      result?: string;
      verified_by?: string;
    }) => {
      const { data, error } = await aisha.rpc("create_production_equipment_calibration_admin", {
        p_adjustment_made: calibration.adjustment_made ?? false,
        p_calibration_type: calibration.calibration_type,
        p_certificate_doc_id: calibration.certificate_doc_id,
        p_deviation_found: calibration.deviation_found,
        p_deviation_limit: calibration.deviation_limit,
        p_equipment_id: calibration.equipment_id,
        p_metadata: calibration.metadata,
        p_next_due_at: calibration.next_due_at,
        p_notes: calibration.notes,
        p_performed_at: calibration.performed_at,
        p_reference_standard: calibration.reference_standard,
        p_result: calibration.result ?? "pass",
        p_verified_by: calibration.verified_by,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-equipment-calibrations"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-production-equipment"] });
    },
  });
}

// ==================== Equipment Cleaning ====================

/**
 * Hook for fetching equipment cleaning records.
 *
 * @param filters - Optional filters for equipment_id, status
 * @returns Query result with cleaning records
 */
export function useProductionEquipmentCleaningAdmin(filters?: {
  equipment_id?: string;
  status?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-equipment-cleaning", filters],
    queryFn: async (): Promise<ProductionEquipmentCleaning[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_equipment_cleaning_admin", {
        p_equipment_id: filters?.equipment_id,
        p_status: filters?.status,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionEquipmentCleaningSchema, data, "productionCleaning");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating cleaning records (immutable — no update).
 *
 * @returns Mutation for creating a cleaning record
 */
export function useCreateProductionEquipmentCleaningMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cleaning: {
      cleaning_method: string;
      equipment_id: string;
      batch_id_after?: string;
      batch_id_before?: string;
      cleaning_agent?: string;
      metadata?: Json;
      notes?: string;
      performed_at?: string;
      status?: string;
      swab_results?: Json;
      verified_by?: string;
      visual_inspection?: string;
    }) => {
      const { data, error } = await aisha.rpc("create_production_equipment_cleaning_admin", {
        p_batch_id_after: cleaning.batch_id_after,
        p_batch_id_before: cleaning.batch_id_before,
        p_cleaning_agent: cleaning.cleaning_agent,
        p_cleaning_method: cleaning.cleaning_method,
        p_equipment_id: cleaning.equipment_id,
        p_metadata: cleaning.metadata,
        p_notes: cleaning.notes,
        p_performed_at: cleaning.performed_at,
        p_status: cleaning.status ?? "completed",
        p_swab_results: cleaning.swab_results,
        p_verified_by: cleaning.verified_by,
        p_visual_inspection: cleaning.visual_inspection,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-equipment-cleaning"] });
    },
  });
}

// ==================== QC Test Definitions ====================

/**
 * Hook for fetching QC test definitions (master data).
 *
 * @param filters - Optional filters for frequency, is_active
 * @returns Query result with QC test definitions
 */
export function useProductionQcTestDefinitionsAdmin(filters?: {
  frequency?: string;
  is_active?: boolean;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-qc-test-definitions", filters],
    queryFn: async (): Promise<ProductionQcTestDefinition[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_qc_test_definitions_admin", {
        p_frequency: filters?.frequency,
        p_is_active: filters?.is_active,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionQcTestDefinitionSchema, data, "productionQcTestDefs");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating/updating QC test definitions.
 *
 * @returns Mutation for upserting a QC test definition
 */
export function useUpsertProductionQcTestDefinitionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (def: Partial<ProductionQcTestDefinition> & {
      test_code: string;
      test_name: string;
    }) => {
      // Partial<DBRow> fields are `T | null | undefined` (Postgres NULL-able
      // columns) but RPC args are `T | undefined`. Coerce null → undefined so
      // PostgREST omits the field (SQL DEFAULT applies, which is NULL).
      const { data, error } = await aisha.rpc("upsert_production_qc_test_definition_admin", {
        p_applicable_products: def.applicable_products ?? undefined,
        p_applicable_steps: def.applicable_steps ?? undefined,
        p_description: def.description ?? undefined,
        p_frequency: def.frequency ?? "per_batch",
        p_id: def.id ?? undefined,
        p_is_active: def.is_active ?? true,
        p_metadata: (def.metadata ?? undefined) as Json | undefined,
        p_method_ref: def.method_ref ?? undefined,
        p_notes: def.notes ?? undefined,
        p_sampling_plan: (def.sampling_plan ?? undefined) as Json | undefined,
        p_spec_limit_high: def.spec_limit_high ?? undefined,
        p_spec_limit_low: def.spec_limit_low ?? undefined,
        p_target_value: def.target_value ?? undefined,
        p_test_code: def.test_code,
        p_test_name: def.test_name,
        p_units: def.units ?? undefined,
        p_version: def.version ?? "1.0",
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-qc-test-definitions"] });
    },
  });
}

// ==================== Sensor Readings ====================

/**
 * Hook for fetching production sensor readings (IoT/HomeAssistant data).
 *
 * @param filters - Optional filters for batch_id, equipment_id, is_excursion, location_id, reading_type, sensor_code
 * @returns Query result with sensor readings (limited to p_limit, default 500)
 */
export function useProductionSensorReadingsAdmin(filters?: {
  batch_id?: string;
  equipment_id?: string;
  flow_node_id?: string;
  is_excursion?: boolean;
  limit?: number;
  location_id?: string;
  reading_type?: string;
  sensor_code?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");
  return useQuery({
    queryKey: ["admin-production-sensor-readings", filters],
    queryFn: async (): Promise<ProductionSensorReading[]> => {
      if (!canView) return [];
      const { data, error } = await aisha.rpc("get_production_sensor_readings_admin", {
        p_batch_id: filters?.batch_id,
        p_equipment_id: filters?.equipment_id,
        p_flow_node_id: filters?.flow_node_id,
        p_is_excursion: filters?.is_excursion,
        p_limit: filters?.limit ?? 500,
        p_location_id: filters?.location_id,
        p_reading_type: filters?.reading_type,
        p_sensor_code: filters?.sensor_code,
      });
      if (error) throw new Error(error.message);
      return parseRpcArraySafe(productionSensorReadingSchema, data, "productionSensorReadings");
    },
    enabled: canView,
  });
}

/**
 * Mutation hook for creating sensor readings (immutable — no update).
 *
 * @returns Mutation for creating a sensor reading
 */
export function useCreateProductionSensorReadingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reading: {
      reading_type: string;
      sensor_code: string;
      unit: string;
      value: number;
      batch_id?: string;
      equipment_id?: string;
      excursion_severity?: string;
      flow_node_id?: string;
      is_excursion?: boolean;
      location_id?: string;
      metadata?: Json;
      recorded_at?: string;
      source?: string;
    }) => {
      const { data, error } = await aisha.rpc("create_production_sensor_reading_admin", {
        p_batch_id: reading.batch_id,
        p_equipment_id: reading.equipment_id,
        p_excursion_severity: reading.excursion_severity,
        p_flow_node_id: reading.flow_node_id,
        p_is_excursion: reading.is_excursion ?? false,
        p_location_id: reading.location_id,
        p_metadata: reading.metadata,
        p_reading_type: reading.reading_type,
        p_recorded_at: reading.recorded_at,
        p_sensor_code: reading.sensor_code,
        p_source: reading.source ?? "homeassistant",
        p_unit: reading.unit,
        p_value: reading.value,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-production-sensor-readings"] });
    },
  });
}
