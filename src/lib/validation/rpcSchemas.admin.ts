import { z } from "zod";

export {
  parseRpcArray,
  parseRpcResponse,
  parseRpcResponse as parseRpcObject,
} from "@/lib/validation/rpcSchemas";

// ============================================================================
// Expedition Schemas (Admin/Operations)
// ============================================================================

/**
 * Schéma pro záznam v kalendáři expedic.
 * 
 * Používáno v admin dashboardu pro plánování zásilek.
 */
export const expeditionCalendarEntrySchema = z.object({
  id: z.string().uuid(),
  expedition_date: z.string(),
  cut_off_date: z.string(),
  product_name: z.string().nullable(),
  product_id: z.string().uuid().nullable(),
  study_name: z.string().nullable(),
  study_id: z.string().uuid().nullable(),
  planned_shipments: z.number(),
  confirmed_shipments: z.number(),
  packed_shipments: z.number(),
  sent_shipments: z.number(),
  status: z.enum(["planned", "preparing", "packing", "shipping", "completed", "cancelled"]),
  allocated_batches: z.array(
    z.object({
      batch_id: z.string().uuid(),
      batch_number: z.string(),
      units_allocated: z.number(),
      expiry_date: z.string().nullable(),
    })
  ),
  notes: z.string().nullable(),
});

/**
 * Schéma pro plán expedice.
 * 
 * Definuje strukturu plánu pro konkrétní datum a produkty.
 */
export const expeditionPlanSchema = z.object({
  expedition_date: z.string(),
  cut_off_date: z.string(),
  plans: z.array(
    z.object({
      product_id: z.string().uuid(),
      product_name: z.string(),
      study_id: z.string().uuid(),
      study_name: z.string(),
      member_count: z.number(),
      packages_needed: z.number(),
    })
  ),
});

export const batchAvailabilitySchema = z.object({
  product_id: z.string().uuid(),
  requested: z.number(),
  available: z.number(),
  sufficient: z.boolean(),
  shortage: z.number(),
  batches: z.array(
    z.object({
      batch_id: z.string().uuid(),
      batch_number: z.string(),
      available_units: z.number(),
      expiry_date: z.string().nullable(),
    })
  ),
});

export const batchAllocationResultSchema = z.object({
  success: z.boolean(),
  requested: z.number(),
  allocated: z.number(),
  remaining: z.number(),
  allocations: z.array(
    z.object({
      batch_id: z.string().uuid(),
      batch_number: z.string(),
      quantity: z.number(),
      expiry_date: z.string().nullable(),
      allocated_at: z.string(),
    })
  ),
});

export const batchInventoryItemSchema = z.object({
  batch_id: z.string().uuid(),
  batch_number: z.string(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  batch_status: z.string(),
  total_units: z.number(),
  available_units: z.number(),
  assigned_units: z.number(),
  shipped_units: z.number(),
  expiry_date: z.string().nullable(),
  batch_created_at: z.string(),
  quality_approved: z.boolean(),
});

// ============================================================================
// Studies (Admin)
// ============================================================================

export const studyListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
});

// ============================================================================
// Consent Templates + Questionnaires (Admin RPC)
// ============================================================================

export const consentTemplateAdminSchema = z.object({
  id: z.string().uuid(),
  template_key: z.string(),
  title_key: z.string().nullable(),
  content_key: z.string().nullable(),
  description_key: z.string().nullable(),
  checkbox_label_key: z.string().nullable(),
  version: z.string(),
  is_active: z.boolean(),
  requires_signature: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  consent_type: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  document_url: z.string().nullable().optional(),
  base_locale: z.string().nullable().optional(),
});

export const studyConsentRequirementAdminSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  consent_template_id: z.string().uuid(),
  is_required: z.boolean(),
  sort_order: z.number(),
  created_at: z.string(),
  template_key: z.string(),
  template_title_key: z.string().nullable(),
});

export const studyConsentItemAdminSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  consent_key: z.string(),
  title_key: z.string().nullable(),
  description_key: z.string().nullable(),
  checkbox_label_key: z.string().nullable(),
  document_url: z.string().nullable(),
  is_required: z.boolean(),
  display_order: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const questionBlockAdminSchema = z.object({
  id: z.string().uuid(),
  block_key: z.string(),
  created_at: z.string(),
  description_key: z.string().nullable(),
  is_active: z.boolean(),
  questions: z.unknown(),
  sort_order: z.number(),
  text_key: z.string().nullable(),
  updated_at: z.string(),
});

export const studyQuestionnaireAdminSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  description_key: z.string().nullable().default(null),
  display_order: z.number().nullable(),
  ends_after_days: z.number().nullable(),
  frequency_days: z.number().nullable(),
  frequency_type: z.string().nullable(),
  is_active: z.boolean(),
  is_required: z.boolean(),
  questionnaire_code: z.string().nullable().default(null),
  questionnaire_id: z.string().uuid().nullable(),
  questionnaire_name: z.string().nullable().default(null),
  questionnaire_type: z.string().nullable(),
  starts_after_days: z.number().nullable(),
  study_id: z.string().uuid(),
  title_key: z.string().nullable().default(null),
  token_reward: z.number().nullable(),
  updated_at: z.string().nullable().default(null),
});

export const questionnaireAdminSchema = z.object({
  id: z.string().uuid(),
  base_locale: z.string().nullable().optional(),
  code: z.string(),
  created_at: z.string(),
  description_key: z.string().nullable().optional(),
  is_active: z.boolean(),
  name: z.string(),
  name_key: z.string().nullable().optional(),
  points_reward: z.number().nullable().optional(),
  questionnaire_type: z.string().nullable().optional(),
  questions: z.unknown(),
  question_count: z.number().nullable().optional(),
  token_reward: z.number().nullable().optional(),
  updated_at: z.string(),
  version: z.number().nullable().optional(),
});

// ============================================================================
// Types (inferred)
// ============================================================================

export type ExpeditionCalendarEntryValidated = z.infer<typeof expeditionCalendarEntrySchema>;
export type ExpeditionPlanValidated = z.infer<typeof expeditionPlanSchema>;
export type BatchAvailabilityValidated = z.infer<typeof batchAvailabilitySchema>;
export type BatchAllocationResultValidated = z.infer<typeof batchAllocationResultSchema>;
export type BatchInventoryItemValidated = z.infer<typeof batchInventoryItemSchema>;
export type StudyListItemValidated = z.infer<typeof studyListItemSchema>;
