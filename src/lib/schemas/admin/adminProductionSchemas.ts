/**
 * Admin Production Schemas — batches, workflows, vials, milestones, logs,
 * protocol steps, sensor alerts, angels' share, traceability, labels
 */

import { z } from "zod";

// ==========================================
// AdminProduction Schemas
// ==========================================

/**
 * Schema for get_production_batches_admin RPC response.
 * Matches the actual database RPC return type.
 */
export const productionBatchRpcSchema = z.object({
  id: z.string(),
  batch_code: z.string(),
  product_id: z.string().nullable(),
  product_name: z.string(),
  study_id: z.string().nullable(),
  purpose: z.string(),
  status: z.string(),
  target_quantity: z.number(),
  actual_quantity: z.number().nullable(),
  unit: z.string().nullable(),
  raw_material_lot: z.string().nullable(),
  expiry_date: z.string().nullable(),
  content_type: z.string().nullable(),
  production_date: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string(),
  blockchain_tx_hash: z.string().nullable(),
  blockchain_recorded_at: z.string().nullable(),
  qc_approved_at: z.string().nullable(),
  qc_approved_by: z.string().nullable(),
  qc_notes: z.string().nullable(),
  released_at: z.string().nullable(),
  supplier_info: z.unknown().nullable(),
  workflow_template_id: z.string().nullable(),
});

export type ProductionBatchRpc = z.infer<typeof productionBatchRpcSchema>;

export const productionBatchArraySchema = z.array(productionBatchRpcSchema);

export const productListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string().optional(),
});

export type ProductListItem = z.infer<typeof productListItemSchema>;

export const productListArraySchema = z.array(productListItemSchema);

// ==========================================
// ProductWorkflowManager Schemas
// ==========================================

export const workflowStepSchema = z.object({
  order: z.number(),
  name: z.string(),
  type: z.string(),
  expectedInput: z.number().optional(),
  expectedOutput: z.number().optional(),
  expectedLoss: z.number().optional(),
});

export const workflowTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  product_id: z.string().uuid().nullable(),
  is_default: z.boolean(),
  workflow_data: z.object({
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
  }).nullable(),
  workflow_steps: z.array(workflowStepSchema).nullable(),
  created_at: z.string(),
  product: z.object({ name: z.string() }).nullable().optional(),
  current_version_number: z.number().nullable().optional(),
});

export type WorkflowTemplateRow = z.infer<typeof workflowTemplateSchema>;

export const workflowTemplateArraySchema = z.array(workflowTemplateSchema);

// ==========================================
// Workflow Template Version Schema
// ==========================================

export const workflowTemplateVersionSchema = z.object({
  id: z.string().uuid(),
  template_id: z.string().uuid(),
  version_number: z.number(),
  workflow_data: z.object({
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
  }).nullable(),
  workflow_steps: z.array(workflowStepSchema).nullable(),
  change_summary: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
});

export type WorkflowTemplateVersionRow = z.infer<typeof workflowTemplateVersionSchema>;

export const workflowTemplateVersionArraySchema = z.array(workflowTemplateVersionSchema);

// ==========================================
// Production Sensor Alert Schema
// ==========================================

export const productionSensorAlertSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid().nullable(),
  node_id: z.string().uuid().nullable(),
  alert_type: z.string(),
  severity: z.string(),
  metric_name: z.string(),
  threshold_value: z.number(),
  actual_value: z.number(),
  message: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  acknowledged_by: z.string().uuid().nullable(),
  resolved_at: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});

export type ProductionSensorAlertRow = z.infer<typeof productionSensorAlertSchema>;

export const productionSensorAlertArraySchema = z.array(productionSensorAlertSchema);

// ==========================================
// Angels' Share Report Schema
// ==========================================

export const angelsShareReportItemSchema = z.object({
  batch_id: z.string().uuid(),
  batch_code: z.string(),
  substance_id: z.string().uuid(),
  substance_code: z.string(),
  substance_name: z.string(),
  total_input_volume_l: z.number(),
  total_output_volume_l: z.number(),
  total_loss_volume_l: z.number(),
  loss_pct: z.number(),
  avg_input_concentration_pct: z.number(),
  avg_output_concentration_pct: z.number(),
  pure_alcohol_loss_l: z.number(),
  record_count: z.number(),
  first_flow_date: z.string().nullable(),
  last_flow_date: z.string().nullable(),
});

export type AngelsShareReportItem = z.infer<typeof angelsShareReportItemSchema>;

export const angelsShareReportArraySchema = z.array(angelsShareReportItemSchema);

// ==========================================
// Cross-Batch Traceability Schema
// ==========================================

export const crossBatchTraceabilityItemSchema = z.object({
  trace_level: z.number(),
  batch_id: z.string().uuid(),
  batch_code: z.string(),
  material_id: z.string().uuid().nullable(),
  material_code: z.string().nullable(),
  material_name: z.string().nullable(),
  total_volume_l: z.number(),
  total_pure_l: z.number(),
  record_count: z.number(),
});

export type CrossBatchTraceabilityItem = z.infer<typeof crossBatchTraceabilityItemSchema>;

export const crossBatchTraceabilityArraySchema = z.array(crossBatchTraceabilityItemSchema);

// ==========================================
// AdminProduction Batch Detail Schemas
// ==========================================

export const productionWorkflowStepSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid(),
  step_name: z.string(),
  step_code: z.string(),
  step_order: z.number(),
  status: z.string(),
  description: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  completed_by: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ProductionWorkflowStepRow = z.infer<typeof productionWorkflowStepSchema>;

export const productionWorkflowStepArraySchema = z.array(productionWorkflowStepSchema);

export const productionMilestoneSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid(),
  milestone_code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  achieved_at: z.string().nullable(),
  blockchain_tx_hash: z.string().nullable(),
  created_at: z.string(),
});

export type ProductionMilestoneRow = z.infer<typeof productionMilestoneSchema>;

export const productionMilestoneArraySchema = z.array(productionMilestoneSchema);

export const productVialSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid(),
  vial_code: z.string(),
  content_type: z.string().nullable(),
  status: z.string(),
  assigned_study_id: z.string().uuid().nullable(),
  manufactured_at: z.string().nullable(),
  dispensed_at: z.string().nullable(),
  qr_code_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ProductVialRow = z.infer<typeof productVialSchema>;

export const productVialArraySchema = z.array(productVialSchema);

// ==========================================
// ProductionLogs Schemas
// ==========================================

export const productionLogAdminSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid().nullable(),
  batch_code: z.string().nullable(),
  product_name: z.string().nullable(),
  workflow_step_id: z.string().uuid().nullable(),
  log_type: z.string(),
  log_category: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  input_volume: z.number().nullable(),
  input_concentration: z.number().nullable(),
  output_volume: z.number().nullable(),
  output_concentration: z.number().nullable(),
  loss_volume: z.number().nullable(),
  waste_volume: z.number().nullable(),
  material_lot: z.string().nullable(),
  source_container: z.string().nullable(),
  target_container: z.string().nullable(),
  temperature: z.number().nullable(),
  notes: z.string().nullable(),
  performed_by: z.string().uuid().nullable(),
  performed_by_name: z.string().nullable(),
  performed_at: z.string(),
  verified_by: z.string().uuid().nullable(),
  verified_at: z.string().nullable(),
  created_at: z.string(),
});

export type ProductionLogAdminRow = z.infer<typeof productionLogAdminSchema>;
export const productionLogAdminArraySchema = z.array(productionLogAdminSchema);

export const activeBatchDropdownSchema = z.object({
  id: z.string().uuid(),
  batch_code: z.string(),
  product_name: z.string(),
});

export const activeBatchDropdownArraySchema = z.array(activeBatchDropdownSchema);

// ==========================================
// LabelTemplates Schemas (admin)
// ==========================================

export const labelTemplateAdminSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid().nullable(),
  product_name: z.string().nullable(),
  product_slug: z.string().nullable(),
  version: z.string().nullable(),
  version_date: z.string().nullable(),
  status: z.string().nullable(),
  product_name_key: z.string().nullable(),
  description_key: z.string().nullable(),
  composition_key: z.string().nullable(),
  usage_instructions_key: z.string().nullable(),
  manufacturer: z.string().nullable(),
  manufacturer_address: z.string().nullable(),
  country_of_origin: z.string().nullable(),
  registration_number: z.string().nullable(),
  label_pdf_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type LabelTemplateAdminRow = z.infer<typeof labelTemplateAdminSchema>;
export const labelTemplateAdminArraySchema = z.array(labelTemplateAdminSchema);

export const labelArchivePublicAdminSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid().nullable(),
  product_name: z.string().nullable(),
  product_slug: z.string().nullable(),
  template_id: z.string().uuid().nullable(),
  version: z.string().nullable(),
  version_date: z.string().nullable(),
  archived_at: z.string(),
  archive_reason: z.string().nullable(),
  pdf_url: z.string().nullable(),
  is_public: z.boolean(),
});

export type LabelArchivePublicAdminRow = z.infer<typeof labelArchivePublicAdminSchema>;
export const labelArchivePublicAdminArraySchema = z.array(labelArchivePublicAdminSchema);

// ==========================================
// Production protocol steps (admin)
// ==========================================

export const productionProtocolStepAdminSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid(),
  step_order: z.number().int(),
  step_name: z.string(),
  step_type: z.string(),
  expected_input_volume: z.number().nullable(),
  expected_output_volume: z.number().nullable(),
  actual_input_volume: z.number().nullable(),
  actual_output_volume: z.number().nullable(),
  expected_loss: z.number().nullable(),
  actual_loss: z.number().nullable(),
  status: z.enum(["pending", "in_progress", "completed", "skipped", "failed"]),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  notes: z.string().nullable(),
  verification_notes: z.string().nullable(),
  verified_at: z.string().nullable(),
  tokens_minted: z.number().nullable(),
  tokens_burned: z.number().nullable(),
});

export type ProductionProtocolStepAdminRow = z.infer<typeof productionProtocolStepAdminSchema>;
export const productionProtocolStepAdminArraySchema = z.array(productionProtocolStepAdminSchema);
