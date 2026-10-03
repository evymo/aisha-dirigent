/**
 * @fileoverview ERP Zod schemas and types for production admin hooks
 * All schemas for suppliers, locations, equipment, lots, inventory events,
 * batch materials, deviations, CAPA, release decisions, calibrations,
 * cleaning, QC test definitions, and sensor readings.
 */

import { z } from "zod";

// ==================== Schemas ====================

export const productionSupplierSchema = z.object({
  id: z.string().uuid(),
  supplier_code: z.string(),
  supplier_name: z.string(),
  country: z.string().nullable(),
  contacts: z.unknown().nullable(),
  qualification_status: z.string(),
  approved_at: z.string().nullable(),
  approved_by: z.string().uuid().nullable(),
  risk_level: z.string(),
  certificates: z.unknown().nullable(),
  audit_history: z.unknown().nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
});

export const productionLocationSchema = z.object({
  id: z.string().uuid(),
  location_code: z.string(),
  location_name: z.string(),
  location_type: z.string(),
  address: z.unknown().nullable(),
  gmp_zone: z.string().nullable(),
  temp_range_min: z.number().nullable(),
  temp_range_max: z.number().nullable(),
  humidity_range_min: z.number().nullable(),
  humidity_range_max: z.number().nullable(),
  parent_location_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
});

export const productionEquipmentSchema = z.object({
  id: z.string().uuid(),
  asset_tag: z.string(),
  equipment_name: z.string(),
  model: z.string().nullable(),
  serial_no: z.string().nullable(),
  manufacturer: z.string().nullable(),
  resource_id: z.string().uuid().nullable(),
  location_id: z.string().uuid().nullable(),
  gmp_criticality: z.string(),
  qualification_status: z.string(),
  last_qualified_at: z.string().nullable(),
  next_qualification_due: z.string().nullable(),
  power_kw: z.number().nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
});

export const productionLotSchema = z.object({
  id: z.string().uuid(),
  lot_number: z.string(),
  item_id: z.string().uuid(),
  supplier_id: z.string().uuid().nullable(),
  supplier_lot: z.string().nullable(),
  received_at: z.string().nullable(),
  manufactured_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  quantity: z.number(),
  remaining_quantity: z.number(),
  uom: z.string(),
  status: z.string(),
  coa_document_id: z.string().uuid().nullable(),
  storage_location_id: z.string().uuid().nullable(),
  batch_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
});

export const productionInventoryEventSchema = z.object({
  id: z.string().uuid(),
  lot_id: z.string().uuid(),
  location_id: z.string().uuid().nullable(),
  event_type: z.string(),
  quantity: z.number(),
  uom: z.string(),
  ref_type: z.string().nullable(),
  ref_id: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  performed_by: z.string().uuid().nullable(),
  performed_at: z.string(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
});

export const productionBatchMaterialSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid(),
  step_id: z.string().uuid().nullable(),
  lot_id: z.string().uuid().nullable(),
  item_id: z.string().uuid(),
  direction: z.string(),
  planned_qty: z.number().nullable(),
  actual_qty: z.number().nullable(),
  uom: z.string(),
  variance_pct: z.number().nullable(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
});

export const productionDeviationSchema = z.object({
  id: z.string().uuid(),
  deviation_number: z.string(),
  batch_id: z.string().uuid().nullable(),
  step_id: z.string().uuid().nullable(),
  equipment_id: z.string().uuid().nullable(),
  lot_id: z.string().uuid().nullable(),
  severity: z.string(),
  category: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  root_cause: z.string().nullable(),
  immediate_action: z.string().nullable(),
  disposition: z.string().nullable(),
  status: z.string(),
  initiated_at: z.string(),
  initiated_by: z.string().uuid().nullable(),
  investigated_by: z.string().uuid().nullable(),
  resolved_at: z.string().nullable(),
  resolved_by: z.string().uuid().nullable(),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export const productionCapaSchema = z.object({
  id: z.string().uuid(),
  capa_number: z.string(),
  source_deviation_id: z.string().uuid().nullable(),
  capa_type: z.string(),
  title: z.string(),
  description: z.string(),
  actions: z.unknown().nullable(),
  owner_id: z.string().uuid().nullable(),
  due_date: z.string().nullable(),
  status: z.string(),
  effectiveness_check: z.unknown().nullable(),
  effectiveness_verified_at: z.string().nullable(),
  effectiveness_verified_by: z.string().uuid().nullable(),
  closed_at: z.string().nullable(),
  closed_by: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
});

export const productionReleaseDecisionSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid(),
  decision: z.string(),
  decision_at: z.string(),
  decided_by: z.string().uuid(),
  reason: z.string().nullable(),
  linked_deviation_id: z.string().uuid().nullable(),
  conditions: z.string().nullable(),
  review_checklist: z.unknown().nullable(),
  review_notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
});

export const productionEquipmentCalibrationSchema = z.object({
  id: z.string().uuid(),
  equipment_id: z.string().uuid(),
  calibration_type: z.string(),
  performed_at: z.string(),
  next_due_at: z.string().nullable(),
  result: z.string(),
  certificate_doc_id: z.string().uuid().nullable(),
  reference_standard: z.string().nullable(),
  deviation_found: z.number().nullable(),
  deviation_limit: z.number().nullable(),
  adjustment_made: z.boolean(),
  performed_by: z.string().uuid().nullable(),
  verified_by: z.string().uuid().nullable(),
  verified_at: z.string().nullable(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
});

export const productionEquipmentCleaningSchema = z.object({
  id: z.string().uuid(),
  equipment_id: z.string().uuid(),
  cleaning_method: z.string(),
  cleaning_agent: z.string().nullable(),
  performed_at: z.string(),
  performed_by: z.string().uuid().nullable(),
  verified_by: z.string().uuid().nullable(),
  verified_at: z.string().nullable(),
  swab_results: z.unknown().nullable(),
  visual_inspection: z.string().nullable(),
  status: z.string(),
  batch_id_before: z.string().uuid().nullable(),
  batch_id_after: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
});

export const productionQcTestDefinitionSchema = z.object({
  id: z.string().uuid(),
  test_code: z.string(),
  test_name: z.string(),
  method_ref: z.string().nullable(),
  description: z.string().nullable(),
  units: z.string().nullable(),
  spec_limit_low: z.number().nullable(),
  spec_limit_high: z.number().nullable(),
  target_value: z.number().nullable(),
  sampling_plan: z.unknown().nullable(),
  applicable_products: z.array(z.string()).nullable(),
  applicable_steps: z.array(z.string()).nullable(),
  frequency: z.string(),
  version: z.string(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
});

export const productionSensorReadingSchema = z.object({
  id: z.string().uuid(),
  sensor_code: z.string(),
  location_id: z.string().uuid().nullable(),
  equipment_id: z.string().uuid().nullable(),
  batch_id: z.string().uuid().nullable(),
  flow_node_id: z.string().uuid().nullable(),
  reading_type: z.string(),
  value: z.number(),
  unit: z.string(),
  recorded_at: z.string(),
  source: z.string(),
  is_excursion: z.boolean(),
  excursion_severity: z.string().nullable(),
  excursion_acknowledged_by: z.string().uuid().nullable(),
  excursion_acknowledged_at: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
});

// ==================== Types ====================

export type ProductionSupplier = z.infer<typeof productionSupplierSchema>;
export type ProductionLocation = z.infer<typeof productionLocationSchema>;
export type ProductionEquipment = z.infer<typeof productionEquipmentSchema>;
export type ProductionLot = z.infer<typeof productionLotSchema>;
export type ProductionInventoryEvent = z.infer<typeof productionInventoryEventSchema>;
export type ProductionBatchMaterial = z.infer<typeof productionBatchMaterialSchema>;
export type ProductionDeviation = z.infer<typeof productionDeviationSchema>;
export type ProductionCapa = z.infer<typeof productionCapaSchema>;
export type ProductionReleaseDecision = z.infer<typeof productionReleaseDecisionSchema>;
export type ProductionEquipmentCalibration = z.infer<typeof productionEquipmentCalibrationSchema>;
export type ProductionEquipmentCleaning = z.infer<typeof productionEquipmentCleaningSchema>;
export type ProductionQcTestDefinition = z.infer<typeof productionQcTestDefinitionSchema>;
export type ProductionSensorReading = z.infer<typeof productionSensorReadingSchema>;

// ==================== Helper ====================

/**
 * Safely parse RPC array response using safeParse per item.
 * Invalid items are silently dropped.
 */
export function parseRpcArraySafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  label: string,
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
