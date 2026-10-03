/**
 * Zod schemas for validating RPC responses
 * 
 * These schemas provide runtime validation for data returned from Supabase RPC functions.
 * This ensures type safety at runtime, not just at compile time.
 */

import { z } from "zod";

// ============================================================================
// Utility for safe parsing with logging
// ============================================================================

import { safeWarn } from "@/lib/security/safeLogger";

const formatZodIssues = (error: z.ZodError, limit: number) => {
  const items = error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}:${issue.code}`;
  });

  const omitted = Math.max(0, error.issues.length - items.length);
  return `zod_issues=${error.issues.length} sample=${items.join(",")}${omitted ? ` omitted=${omitted}` : ""}`;
};

/**
 * Bezpečně parsuje odpověď z RPC volání.
 * 
 * Pokud validace selže, zaloguje varování a vyhodí chybu.
 * 
 * @param schema - Zod schéma pro validaci
 * @param data - Data k validaci
 * @param context - Kontext pro logování (např. název RPC)
 * @returns Validovaná data
 * @throws Error pokud validace selže
 */
export function parseRpcResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    safeWarn(`rpc.validation.${context}`, formatZodIssues(result.error, 10));
    // For arrays, return empty array on validation failure
    // For objects, throw to prevent using invalid data
    throw new Error(`RPC response validation failed: ${context}`);
  }
  return result.data;
}

/**
 * Bezpečně parsuje pole z RPC odpovědi.
 * 
 * Validuje každou položku zvlášť. Nevalidní položky jsou přeskočeny a zalogovány.
 * Vrací pouze validní položky.
 * 
 * @param schema - Zod schéma pro jednu položku
 * @param data - Data k validaci (očekáváno pole)
 * @param context - Kontext pro logování
 * @returns Pole validních položek
 */
export function parseRpcArray<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string
): T[] {
  const input = Array.isArray(data) ? data : [];

  const validated: T[] = [];
  const invalidSamples: string[] = [];
  let invalidCount = 0;

  for (const item of input) {
    const result = schema.safeParse(item);
    if (result.success) {
      validated.push(result.data);
      continue;
    }

    invalidCount += 1;
    if (invalidSamples.length < 5) {
      invalidSamples.push(formatZodIssues(result.error, 3));
    }
  }

  if (invalidCount > 0) {
    safeWarn(
      `rpc.validation.${context}`,
      `invalid_items=${invalidCount} total=${input.length} sample=${invalidSamples.join(" | ")}`
    );
  }

  return validated;
}

// ============================================================================
// Distribution Adjustments Schemas
// ============================================================================

export const distributionAdjustmentTypeSchema = z.enum([
  "dose_increase",
  "dose_decrease",
  "frequency_change",
  "timing_change",
  "temporary_pause",
  "arm_switch",
  "custom",
]);

export const distributionAdjustmentSchema = z.object({
  id: z.string().uuid(),
  member_token: z.string(),
  protocol_id: z.string().uuid().nullable(),
  adjustment_type: distributionAdjustmentTypeSchema,
  new_dose_amount: z.number().nullable(),
  new_doses_per_day: z.number().nullable(),
  new_dose_timing: z.array(z.string()).nullable(),
  new_arm_code: z.string().nullable(),
  effective_from: z.string(),
  effective_until: z.string().nullable(),
  reason: z.string(),
  authorized_by: z.string().uuid().nullable(),
  consultant_note: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const effectiveDistributionSchema = z.object({
  protocol_id: z.string().uuid(),
  product_name: z.string(),
  study_name: z.string(),
  arm_code: z.string().nullable(),
  dose_amount: z.number(),
  dose_unit: z.string(),
  doses_per_day: z.number(),
  dose_timing: z.array(z.string()),
  has_adjustment: z.boolean(),
  adjustment_type: distributionAdjustmentTypeSchema.nullable(),
  adjustment_reason: z.string().nullable(),
  effective_from: z.string().nullable(),
  effective_until: z.string().nullable(),
});

// ============================================================================
// Expedition Schemas
// ============================================================================

// Admin/operations schemas moved to rpcSchemas.admin.ts

// ============================================================================
// Partner Schemas
// ============================================================================

export const partnerProfileSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  certification_level: z.enum(["certified_partner", "certified_provider"]),
  is_production_provider: z.boolean(),
  business_name: z.string().nullable(),
  display_name: z.string(),
  description: z.string().nullable(),
  notes_for_visitors: z.string().nullable().optional(),
  city: z.string(),
  country: z.string(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable(),
  services: z.array(z.string()),
  languages: z.array(z.string()).nullable(),
  is_visible: z.boolean(),
  accepts_online_appointments: z.boolean(),
  accepts_in_person_appointments: z.boolean(),
  certification_passed_at: z.string().nullable(),
  certification_score: z.number().nullable(),
  avatar_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const partnerAvailabilitySchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  day_of_week: z.number().min(0).max(6),
  start_time: z.string(),
  end_time: z.string(),
  is_online: z.boolean(),
  created_at: z.string(),
});

// ============================================================================
// Tokenomics Schemas
// ============================================================================

// Token config schema - alphabetical order matching RPC
export const tokenConfigSchema = z.object({
  burned_supply: z.number(),
  circulating_supply: z.number(),
  created_at: z.string(),
  description: z.string().nullable(),
  emission_rate_daily: z.number().nullable(),
  id: z.string().uuid(),
  is_active: z.boolean(),
  locked_supply: z.number(),
  name: z.string(),
  symbol: z.string(),
  token_type: z.string(),
  total_supply: z.number(),
  updated_at: z.string(),
});

// Token reward rule schema - alphabetical order matching RPC
export const tokenRewardRuleSchema = z.object({
  action_name_key: z.string(),
  action_type: z.string(),
  base_amount: z.number(),
  cooldown_hours: z.number(),
  created_at: z.string(),
  daily_limit: z.number().nullable(),
  description_key: z.string().nullable(),
  id: z.string().uuid(),
  is_active: z.boolean(),
  max_amount: z.number().nullable(),
  membership_tier_required: z.string().nullable(),
  min_amount: z.number().nullable(),
  monthly_limit: z.number().nullable(),
  multiplier: z.coerce.number(),
  requires_membership: z.boolean(),
  sort_order: z.number(),
  token_type: z.string(),
  updated_at: z.string(),
  weekly_limit: z.number().nullable(),
});

// Token burn schema - alphabetical order matching RPC
export const tokenBurnSchema = z.object({
  amount: z.number(),
  burn_reason: z.string(),
  burned_by: z.string().uuid(),
  created_at: z.string(),
  description: z.string().nullable(),
  id: z.string().uuid(),
  source_user_id: z.string().uuid().nullable(),
  token_type: z.string(),
});

// Token allocation schema - alphabetical order matching RPC
export const tokenAllocationSchema = z.object({
  allocation_name: z.string(),
  allocation_type: z.string(),
  cliff_months: z.number().nullable(),
  created_at: z.string(),
  distributed_amount: z.number(),
  id: z.string().uuid(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  token_type: z.string(),
  total_amount: z.number(),
  updated_at: z.string(),
  vesting_end: z.string().nullable(),
  vesting_schedule: z.string(),
  vesting_start: z.string().nullable(),
});

export const tokenomicsOverviewSchema = z.object({
  token_configs: z.array(z.record(z.unknown())),
  transaction_summary: z.array(
    z.object({
      token_type: z.string(),
      transaction_type: z.string(),
      amount: z.number(),
    })
  ),
  active_locks: z.array(
    z.object({
      token_type: z.string(),
      amount: z.number(),
    })
  ),
  burn_summary: z.array(
    z.object({
      token_type: z.string(),
      amount: z.number(),
    })
  ),
});

// ============================================================================
// Tokens Schemas
// ============================================================================

export const processRewardResultSchema = z.object({
  success: z.boolean(),
  awarded: z.number().optional(),
  message: z.string().optional(),
  transaction_id: z.string().uuid().optional(),
});

// ============================================================================
// Client Details Schema (Partner MyClients)
// ============================================================================

export const clientDetailsSchema = z.object({
  user_id: z.string().uuid(),
  overall_feeling: z.number().nullable().optional(),
  energy_perception: z.number().nullable().optional(),
  physical_confidence: z.number().nullable().optional(),
  mental_wellbeing: z.number().nullable().optional(),
  sleep_satisfaction: z.number().nullable().optional(),
  primary_concern: z.string(),
  secondary_concerns: z.array(z.string()).nullable().optional(),
  main_goal: z.string(),
  timeframe_expectation: z.string().nullable().optional(),
  age_range: z.string().nullable().optional(),
  has_chronic_condition: z.boolean().nullable().optional(),
  condition_brief: z.string().nullable().optional(),
  mentor_preference: z.string().nullable().optional(),
  communication_style: z.string().nullable().optional(),
  has_consent: z.boolean(),
});

export const assignedClientSchema = z.object({
  onboarding_id: z.string().uuid(),
  user_id: z.string().uuid(),
  display_name: z.string(),
  overall_feeling: z.number(),
  energy_perception: z.number(),
  primary_concern: z.string(),
  main_goal: z.string(),
  phone_call_scheduled_at: z.string().nullable(),
  phone_call_completed_at: z.string().nullable(),
  onboarding_completed: z.boolean(),
  has_data_sharing_consent: z.boolean(),
  consent_status: z.string(),
  assigned_at: z.string(),
});

// ============================================================================
// Document Analysis Schema
// ============================================================================

export const documentAiInsightsSchema = z.array(z.string());
export const documentExtractedDataSchema = z.record(z.string(), z.unknown());

// ============================================================================
// Studies Schema
// ============================================================================

// Admin schema moved to rpcSchemas.admin.ts

// ============================================================================
// Consent Templates Schema (Admin RPC)
// ============================================================================

// Admin schemas moved to rpcSchemas.admin.ts

// Schema for get_study_consent_requirements_localized RPC (member-facing)
export const studyConsentRequirementLocalizedSchema = z.object({
  id: z.string().uuid(),
  consent_template_id: z.string().uuid(),
  is_required: z.boolean(),
  sort_order: z.number(),
  template_key: z.string(),
  title: z.string(),
  content: z.string(),
  version: z.string(),
  requires_signature: z.boolean(),
});

// ============================================================================
// Question Blocks Schema (Admin RPC)
// ============================================================================

// Admin schema moved to rpcSchemas.admin.ts


// Admin schemas moved to rpcSchemas.admin.ts

// ============================================================================
// Translations Schema
// ============================================================================

export const translationSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  locale: z.string(),
  value: z.string(),
  namespace: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const translationValueSchema = z.string().nullable();

export const translationMapEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
});

// ============================================================================
// Questionnaire Blocks (member-facing)
// ============================================================================

export const questionnaireBlockLocalizedSchema = z.object({
  id: z.string().uuid(),
  block_code: z.string(),
  question_type: z.string(),
  translated_text: z.string().nullable(),
  translated_description: z.string().nullable(),
  config: z.record(z.unknown()).nullable(),
  is_required: z.boolean(),
  display_order: z.number(),
  step_number: z.number().nullable(),
  section_key: z.string().nullable(),
  option_translations: z.record(z.string()).nullable(),
});

// ============================================================================
// Study Consents (member-facing)
// ============================================================================

export const combinedStudyConsentSchema = z.object({
  id: z.string().uuid(),
  consent_key: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  checkbox_label: z.string().nullable(),
  is_required: z.boolean(),
  display_order: z.number(),
  document_url: z.string().nullable(),
  study_code: z.string().nullable(),
  is_umbrella: z.boolean(),
});

// ============================================================================
// Translations with status (admin UI)
// ============================================================================

export const translationWithStatusSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  locale: z.string(),
  value: z.string(),
  namespace: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  source_updated_at: z.string().nullable(),
  is_stale: z.boolean(),
  is_missing: z.boolean(),
});

// ============================================================================
// Type exports (inferred from schemas)
// ============================================================================

/**
 * Validated translation record from RPC response.
 * @public
 */
export type TranslationValidated = z.infer<typeof translationSchema>;
export type DistributionAdjustmentType = z.infer<typeof distributionAdjustmentTypeSchema>;
export type DistributionAdjustmentValidated = z.infer<typeof distributionAdjustmentSchema>;
export type EffectiveDistributionValidated = z.infer<typeof effectiveDistributionSchema>;
export type PartnerProfileValidated = z.infer<typeof partnerProfileSchema>;
export type PartnerAvailabilityValidated = z.infer<typeof partnerAvailabilitySchema>;
export type TokenConfigValidated = z.infer<typeof tokenConfigSchema>;
export type TokenRewardRuleValidated = z.infer<typeof tokenRewardRuleSchema>;
export type TokenBurnValidated = z.infer<typeof tokenBurnSchema>;
export type TokenAllocationValidated = z.infer<typeof tokenAllocationSchema>;
export type TokenomicsOverviewValidated = z.infer<typeof tokenomicsOverviewSchema>;
export type ProcessRewardResultValidated = z.infer<typeof processRewardResultSchema>;
export type ClientDetailsValidated = z.infer<typeof clientDetailsSchema>;
export type AssignedClientValidated = z.infer<typeof assignedClientSchema>;
export type QuestionnaireBlockLocalizedValidated = z.infer<typeof questionnaireBlockLocalizedSchema>;
export type CombinedStudyConsentValidated = z.infer<typeof combinedStudyConsentSchema>;
export type TranslationWithStatusValidated = z.infer<typeof translationWithStatusSchema>;

// ============================================================================
// Data Sharing Consent Schemas
// ============================================================================

export const dataSharingConsentSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  granted_at: z.string(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  partner_profile: z.object({
    id: z.string().uuid(),
    display_name: z.string(),
    business_name: z.string().nullable(),
    city: z.string(),
    certification_level: z.string(),
  }).nullable().optional(),
});

export const availablePartnerForSharingSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  business_name: z.string().nullable(),
  city: z.string(),
  certification_level: z.string(),
  has_consent: z.boolean(),
});

/**
 * Validated data sharing consent record from RPC response.
 * @public
 */
export type DataSharingConsentValidated = z.infer<typeof dataSharingConsentSchema>;

/**
 * Validated partner available for data sharing from RPC response.
 * @public
 */
export type AvailablePartnerForSharingValidated = z.infer<typeof availablePartnerForSharingSchema>;

// ============================================================================
// Certified Partners Schemas
// ============================================================================

export const certifiedPartnerRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  certification_level: z.enum(["certified_partner", "certified_provider"]),
  is_production_provider: z.boolean(),
  business_name: z.string().nullable(),
  display_name: z.string(),
  description: z.string().nullable(),
  notes_for_visitors: z.string().nullable(),
  city: z.string(),
  country: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  services: z.array(z.string()),
  languages: z.array(z.string()).nullable(),
  is_visible: z.boolean(),
  accepts_online_appointments: z.boolean(),
  accepts_in_person_appointments: z.boolean(),
  certification_passed_at: z.string().nullable(),
  certification_score: z.number().nullable(),
  avatar_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  availability: z.unknown().nullable(),
  hasavailability: z.boolean().nullable(),
});

export type CertifiedPartnerRowValidated = z.infer<typeof certifiedPartnerRowSchema>;

// ============================================================================
// Consultant Users Schemas
// ============================================================================

export const consultantUserRegistrationSchema = z.object({
  registration_id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_id: z.string().uuid(),
  study_name: z.string(),
  study_code: z.string(),
  status: z.string(),
  enrolled_at: z.string().nullable(),
});

export type ConsultantUserRegistrationValidated = z.infer<typeof consultantUserRegistrationSchema>;

// ============================================================================
// Permission Catalog Schemas
// ============================================================================

export const permissionCatalogSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  is_system: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const userPermissionRowSchema = z.object({
  permission_code: z.string(),
  category: z.string(),
  role: z.string(),
});

export const appRolePermissionMappingSchema = z.object({
  id: z.string().uuid(),
  role: z.string(),
  permission_code: z.string(),
  granted_at: z.string(),
  granted_by: z.string().nullable(),
});

export type PermissionCatalogValidated = z.infer<typeof permissionCatalogSchema>;
export type UserPermissionRowValidated = z.infer<typeof userPermissionRowSchema>;
export type AppRolePermissionMappingValidated = z.infer<typeof appRolePermissionMappingSchema>;

// ============================================================================
// Admin Data Schemas
// ============================================================================

export const studyRegistrationAdminRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_id: z.string().uuid(),
  status: z.string(),
  group_assignment: z.string().nullable(),
  enrolled_at: z.string().nullable(),
  created_at: z.string(),
  notes: z.string().nullable(),
  baseline_data: z.unknown().nullable(),
  study_name: z.string(),
  study_code: z.string(),
  study_type: z.string(),
  profile_display_name: z.string().nullable(),
  profile_email: z.string().nullable(),
  profile_phone: z.string().nullable(),
  profile_date_of_birth: z.string().nullable(),
  profile_primary_diagnosis: z.string().nullable(),
  profile_current_medications: z.string().nullable(),
  profile_medical_history: z.string().nullable(),
});

export const membersSummaryAdminRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  membership_tier: z.string().nullable(),
  membership_status: z.string().nullable(),
  total_check_ins: z.number(),
  last_check_in: z.string().nullable(),
  registrations_count: z.number(),
});

export type StudyRegistrationAdminRowValidated = z.infer<typeof studyRegistrationAdminRowSchema>;
export type MembersSummaryAdminRowValidated = z.infer<typeof membersSummaryAdminRowSchema>;

// ============================================================================
// sensitive data User Data Schemas (for useConsultantUsers)
// ============================================================================

/**
 * User health check-in summary from audited RPC
 */
export const userCheckInSummarySchema = z.object({
  check_in_date: z.string(),
  pain_level: z.number().nullable(),
  energy_level: z.number().nullable(),
  mood_level: z.number().nullable(),
  sleep_quality: z.number().nullable(),
});

/**
 * User lab result from audited RPC - comprehensive biomarker data
 */
export const userLabResultSchema = z.object({
  id: z.string().uuid(),
  test_date: z.string(),
  status: z.string(),
  crp: z.number().nullable(),
  esr: z.number().nullable(),
  vitamin_d: z.number().nullable(),
  vitamin_b12: z.number().nullable(),
  glucose: z.number().nullable(),
  hba1c: z.number().nullable(),
  insulin: z.number().nullable(),
  cholesterol_total: z.number().nullable(),
  hdl: z.number().nullable(),
  ldl: z.number().nullable(),
  triglycerides: z.number().nullable(),
  ast: z.number().nullable(),
  alt: z.number().nullable(),
  nk_cells: z.number().nullable(),
  cd4_count: z.number().nullable(),
  cd8_count: z.number().nullable(),
  il_6: z.number().nullable(),
  tnf_alpha: z.number().nullable(),
  nad_nadh_ratio: z.number().nullable(),
  omega3_index: z.number().nullable(),
});

/**
 * User dosing log summary from audited RPC
 */
export const userDosingLogSummarySchema = z.object({
  logged_at: z.string(),
  dose_count: z.number().nullable(),
});

/**
 * User questionnaire response from audited RPC - supports dynamic content
 */
export const userQuestionnaireResponseSchema = z.object({
  id: z.string().uuid(),
  completed_at: z.string(),
  questionnaire_id: z.string().uuid(),
  questionnaire_name: z.string().nullable().optional(),
  questionnaire_name_key: z.string().nullable().optional(),
  questionnaire_code: z.string().nullable().optional(),
  questionnaire_version: z.number().nullable().optional(),
});

/**
 * User consent from audited RPC
 */
export const userConsentSchema = z.object({
  id: z.string().uuid(),
  consent_type: z.string(),
  granted: z.boolean(),
  granted_at: z.string().nullable(),
});

export type UserCheckInSummaryValidated = z.infer<typeof userCheckInSummarySchema>;
export type UserLabResultValidated = z.infer<typeof userLabResultSchema>;
export type UserDosingLogSummaryValidated = z.infer<typeof userDosingLogSummarySchema>;
export type UserQuestionnaireResponseValidated = z.infer<typeof userQuestionnaireResponseSchema>;
export type UserConsentValidated = z.infer<typeof userConsentSchema>;

// ============================================================================
// Audit Journal Stats Schema
// ============================================================================

/**
 * Audit stats row from aggregation queries
 * @see get_audit_journal_stats_24h - Returns: action, area, severity, count
 */
export const auditStatsRowSchema = z.object({
  action: z.string().nullable(),
  area: z.string().nullable(),
  severity: z.string().nullable(),
  count: z.coerce.number(),
});

export type AuditStatsRowValidated = z.infer<typeof auditStatsRowSchema>;

// ============================================================================
// Member Access Summary Schemas
// ============================================================================

export const consultantUserRawSchema = z.object({
  registration_id: z.string().uuid(),
  user_id: z.string().uuid(),
  study_id: z.string().uuid(),
  study_name: z.string(),
  study_code: z.string(),
  status: z.string(),
  enrolled_at: z.string().nullable(),
});

export const dataSharingConsentRawSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  granted_at: z.string(),
  revoked_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  consent_requested_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ConsultantUserRawValidated = z.infer<typeof consultantUserRawSchema>;
export type DataSharingConsentRawValidated = z.infer<typeof dataSharingConsentRawSchema>;
