/**
 * Lab Tests Schemas
 * 
 * Zod schemas for lab test data validation and TypeScript type inference.
 * Used in the StoryLoop lab recommendation system.
 * 
 * @module schemas/labTestSchemas
 */

import { z } from "zod";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Sample type required for the test
 */
export const SampleTypeSchema = z.enum([
  "blood",
  "urine",
  "stool",
  "saliva",
]);
export type SampleType = z.infer<typeof SampleTypeSchema>;

/**
 * Test priority in a panel
 */
export const TestPrioritySchema = z.enum([
  "required",
  "recommended",
  "conditional",
  "optional",
]);
export type TestPriority = z.infer<typeof TestPrioritySchema>;

/**
 * Panel timing in the program
 */
export const PanelTimingSchema = z.enum([
  "pre_program",
  "month_3",
  "month_6",
  "month_12",
  "on_indication",
]);
export type PanelTiming = z.infer<typeof PanelTimingSchema>;

/**
 * RTN product identifiers
 */
export const RtnProductSchema = z.enum([
  "retisin",
  "lyastin",
  "floristen",
  "silexil",
]);
export type RtnProduct = z.infer<typeof RtnProductSchema>;

/**
 * Lab test order status
 */
export const LabOrderStatusSchema = z.enum([
  "pending",       // Order created, waiting for scheduling
  "scheduled",     // Appointment scheduled
  "in_progress",   // Sample collected, waiting for results
  "completed",     // Results available
  "cancelled",     // Order cancelled
]);
export type LabOrderStatus = z.infer<typeof LabOrderStatusSchema>;

// =============================================================================
// LAB TEST CATALOG
// =============================================================================

/**
 * Category definition from catalog
 */
export const LabTestCategorySchema = z.object({
  id: z.string(),
  name_key: z.string(),
});
export type LabTestCategory = z.infer<typeof LabTestCategorySchema>;

/**
 * Individual lab test definition from catalog
 */
export const LabTestDefinitionSchema = z.object({
  code: z.string(),
  name_key: z.string(),
  category: z.string(),
  price: z.number().positive(),
  sample_type: SampleTypeSchema,
  requires_fasting: z.boolean(),
  note: z.string().optional(),
});
export type LabTestDefinition = z.infer<typeof LabTestDefinitionSchema>;

/**
 * Full lab tests catalog
 */
export const LabTestsCatalogSchema = z.object({
  version: z.string(),
  last_updated: z.string(),
  currency: z.string(),
  categories: z.array(LabTestCategorySchema),
  tests: z.array(LabTestDefinitionSchema),
});
export type LabTestsCatalog = z.infer<typeof LabTestsCatalogSchema>;

// =============================================================================
// RTN PANELS CONFIG
// =============================================================================

/**
 * Biochemical category of RTN product
 */
export const BiochemicalCategorySchema = z.enum([
  "nucleotide_monophosphates",
  "phospholipids_membrane_fragments",
  "plant_polyphenols_flavonoids",
  "marine_mineral_complex",
]);
export type BiochemicalCategory = z.infer<typeof BiochemicalCategorySchema>;

/**
 * RTN Product definition with full biochemical information
 * 
 * @property mechanism_of_action_key - Translation key for mechanism of action description
 * @property biochemical_category - Category of active substances (nucleotides, phospholipids, etc.)
 * @property source - Raw material source (bovine_blood_pigment, spleen_lipid_extract, etc.)
 * @property production_note_key - Translation key for production process description
 * @property historical_indications - Historical medical indications
 * @property target_biomarkers - Lab biomarkers relevant for monitoring
 * @property contraindications - Conditions where product should not be used
 */
export const RtnProductDefinitionSchema = z.object({
  id: RtnProductSchema,
  name_key: z.string(),
  description_key: z.string(),
  active_substances: z.array(z.string()),
  // Extended fields for AI/lab recommendations
  mechanism_of_action_key: z.string().optional(),
  biochemical_category: BiochemicalCategorySchema.optional(),
  source: z.string().optional(),
  production_note_key: z.string().optional(),
  historical_indications: z.array(z.string()).optional(),
  target_biomarkers: z.array(z.string()).optional(),
  contraindications: z.array(z.string()).optional(),
});
export type RtnProductDefinition = z.infer<typeof RtnProductDefinitionSchema>;

/**
 * Test in a panel with priority and reason
 */
export const PanelTestSchema = z.object({
  code: z.string(),
  priority: TestPrioritySchema,
  reason_key: z.string(),
  note: z.string().optional(),
});
export type PanelTest = z.infer<typeof PanelTestSchema>;

/**
 * Lab test panel definition
 */
export const LabTestPanelSchema = z.object({
  id: z.string(),
  name_key: z.string(),
  description_key: z.string(),
  is_mandatory: z.boolean(),
  timing: PanelTimingSchema,
  applicable_products: z.array(RtnProductSchema),
  conditions: z.array(z.string()).optional(),
  tests: z.array(PanelTestSchema),
  total_estimated_price: z.number().positive(),
});
export type LabTestPanel = z.infer<typeof LabTestPanelSchema>;

/**
 * Condition mapping for AI recommendations
 */
export const ConditionMappingSchema = z.object({
  name_key: z.string(),
  suggested_panels: z.array(z.string()),
  icd10_codes: z.array(z.string()),
});
export type ConditionMapping = z.infer<typeof ConditionMappingSchema>;

/**
 * Priority definition
 */
export const PriorityDefinitionSchema = z.object({
  label_key: z.string(),
  description_key: z.string(),
});
export type PriorityDefinition = z.infer<typeof PriorityDefinitionSchema>;

/**
 * Timing definition
 */
export const TimingDefinitionSchema = z.object({
  label_key: z.string(),
});
export type TimingDefinition = z.infer<typeof TimingDefinitionSchema>;

/**
 * Full RTN panels configuration
 */
export const RtnPanelsConfigSchema = z.object({
  version: z.string(),
  last_updated: z.string(),
  products: z.record(RtnProductSchema, RtnProductDefinitionSchema),
  panels: z.record(z.string(), LabTestPanelSchema),
  condition_mappings: z.record(z.string(), ConditionMappingSchema),
  priority_definitions: z.record(TestPrioritySchema, PriorityDefinitionSchema),
  timing_definitions: z.record(PanelTimingSchema, TimingDefinitionSchema),
});
export type RtnPanelsConfig = z.infer<typeof RtnPanelsConfigSchema>;

// =============================================================================
// LAB TEST RECOMMENDATION (Runtime)
// =============================================================================

/**
 * Individual test recommendation with explanation
 */
export const LabTestRecommendationSchema = z.object({
  code: z.string(),
  name: z.string(),
  category: z.string(),
  priority: TestPrioritySchema,
  reason: z.string(),
  price: z.number().positive(),
  sample_type: SampleTypeSchema,
  requires_fasting: z.boolean(),
});
export type LabTestRecommendation = z.infer<typeof LabTestRecommendationSchema>;

/**
 * Panel recommendation with tests
 */
export const PanelRecommendationSchema = z.object({
  panel_id: z.string(),
  panel_name: z.string(),
  panel_description: z.string(),
  timing: PanelTimingSchema,
  is_mandatory: z.boolean(),
  tests: z.array(LabTestRecommendationSchema),
  total_price: z.number(),
  reason: z.string(),
});
export type PanelRecommendation = z.infer<typeof PanelRecommendationSchema>;

/**
 * Complete lab test recommendation response
 */
export const LabTestRecommendationResponseSchema = z.object({
  story_id: z.string().uuid(),
  user_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  products: z.array(RtnProductSchema),
  conditions: z.array(z.string()),
  panels: z.array(PanelRecommendationSchema),
  total_tests_count: z.number().int().nonnegative(),
  total_estimated_price: z.number().nonnegative(),
  requires_fasting: z.boolean(),
  sample_types_required: z.array(SampleTypeSchema),
  ai_notes: z.string().optional(),
});
export type LabTestRecommendationResponse = z.infer<typeof LabTestRecommendationResponseSchema>;

// =============================================================================
// LAB ORDER (StoryLoop Entry)
// =============================================================================

/**
 * Individual test in a lab order
 */
export const LabOrderTestSchema = z.object({
  code: z.string(),
  name: z.string(),
  priority: TestPrioritySchema,
  reason: z.string(),
  price: z.number().positive(),
  status: z.enum(["pending", "completed"]).default("pending"),
  result_value: z.string().nullable().optional(),
  result_unit: z.string().nullable().optional(),
  result_reference: z.string().nullable().optional(),
  result_flag: z.enum(["normal", "low", "high", "critical"]).nullable().optional(),
});
export type LabOrderTest = z.infer<typeof LabOrderTestSchema>;

/**
 * Lab order metadata for StoryLoop entry
 */
export const LabOrderMetadataSchema = z.object({
  type: z.literal("lab_order"),
  lab_name: z.string().optional(),
  panels: z.array(z.string()),
  tests: z.array(LabOrderTestSchema),
  scheduled_date: z.string().nullable(),
  status: LabOrderStatusSchema,
  total_price: z.number().nonnegative(),
  requires_fasting: z.boolean(),
  sample_types: z.array(SampleTypeSchema),
  result_id: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
});
export type LabOrderMetadata = z.infer<typeof LabOrderMetadataSchema>;

// =============================================================================
// AI RECOMMENDATION REQUEST
// =============================================================================

/**
 * Request payload for AI lab recommendation
 */
export const AiLabRecommendationRequestSchema = z.object({
  story_id: z.string().uuid(),
  user_id: z.string().uuid(),
  products: z.array(RtnProductSchema),
  anamnesis: z.string().optional(),
  existing_conditions: z.array(z.string()).optional(),
  recent_lab_results: z.array(z.object({
    code: z.string(),
    value: z.string(),
    date: z.string(),
  })).optional(),
  exclude_tests: z.array(z.string()).optional(),
  timing: PanelTimingSchema.optional(),
  language: z.enum(["cs", "en"]).default("en"),
});
export type AiLabRecommendationRequest = z.infer<typeof AiLabRecommendationRequestSchema>;

/**
 * AI recommendation response with explanations
 */
export const AiLabRecommendationResponseSchema = z.object({
  success: z.boolean(),
  recommendation: LabTestRecommendationResponseSchema.optional(),
  error: z.string().optional(),
});
export type AiLabRecommendationResponse = z.infer<typeof AiLabRecommendationResponseSchema>;

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Test with full definition (merged catalog + panel info)
 */
export const EnrichedLabTestSchema = LabTestDefinitionSchema.extend({
  priority: TestPrioritySchema,
  reason: z.string(),
  panel_id: z.string(),
});
export type EnrichedLabTest = z.infer<typeof EnrichedLabTestSchema>;

/**
 * Grouped tests by sample type
 */
export const TestsBySampleTypeSchema = z.object({
  blood: z.array(EnrichedLabTestSchema),
  urine: z.array(EnrichedLabTestSchema),
  stool: z.array(EnrichedLabTestSchema),
  saliva: z.array(EnrichedLabTestSchema),
});
export type TestsBySampleType = z.infer<typeof TestsBySampleTypeSchema>;

/**
 * Summary statistics for recommendations
 */
export const RecommendationSummarySchema = z.object({
  total_tests: z.number().int().nonnegative(),
  required_tests: z.number().int().nonnegative(),
  recommended_tests: z.number().int().nonnegative(),
  conditional_tests: z.number().int().nonnegative(),
  optional_tests: z.number().int().nonnegative(),
  total_price: z.number().nonnegative(),
  requires_fasting: z.boolean(),
  sample_types: z.array(SampleTypeSchema),
  panels_count: z.number().int().nonnegative(),
});
export type RecommendationSummary = z.infer<typeof RecommendationSummarySchema>;
