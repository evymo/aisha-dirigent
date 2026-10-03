/**
 * Admin Study Schemas — studies, consultants, contributions, consent items
 */

import { z } from "zod";

// ==========================================
// AdminStudies Schemas
// ==========================================

export const studyRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  name_key: z.string().nullable().optional(),
  description: z.string().nullable(),
  description_key: z.string().nullable().optional(),
  study_type: z.string(),
  target_condition: z.string().nullable(),
  products: z.array(z.string()).nullable(),
  duration_weeks: z.number().nullable(),
  target_registration: z.number().nullable(),
  current_registration: z.number().nullable(),
  is_blinded: z.boolean(),
  is_active: z.boolean(),
  is_umbrella: z.boolean(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  protocol_url: z.string().nullable(),
  funding_goal: z.number().nullable(),
  current_funding: z.number().nullable(),
  funding_deadline: z.string().nullable(),
  funding_status: z.string(),
  min_participants: z.number().nullable(),
  max_participants: z.number().nullable(),
  informed_consent_version: z.string().nullable(),
  informed_consent_special_provisions: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type StudyRow = z.infer<typeof studyRowSchema>;
export const studyRowArraySchema = z.array(studyRowSchema);

// Flat structure matching get_completed_study_contributions_admin RPC
// Note: RPC uses COALESCE so most fields are guaranteed non-null
export const studyContributionRowSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  user_id: z.string().uuid(),
  contribution_type: z.string(),
  amount: z.number(),
  currency: z.string(),
  token_type: z.string(),  // COALESCE to ''
  message: z.string(),     // COALESCE to ''
  is_anonymous: z.boolean(),
  status: z.string(),
  stripe_payment_intent_id: z.string(),  // COALESCE to ''
  created_at: z.string(),
  updated_at: z.string(),
  study_name: z.string(),
  study_code: z.string(),
  user_name: z.string(),
});

export const studyContributionRowArraySchema = z.array(studyContributionRowSchema);

export const studyConsultantRowSchema = z.object({
  study_id: z.string().uuid(),
  status: z.string(),
});

export const studyConsultantRowArraySchema = z.array(studyConsultantRowSchema);

export const studyRegistrationRowSchema = z.object({
  study_id: z.string().uuid(),
  status: z.string(),
});

export const studyRegistrationRowArraySchema = z.array(studyRegistrationRowSchema);

// Schema matches get_studies_overview_admin RPC return columns
// RPC returns: registrations_count, contributions_count, consultants_count, dynamic_funding
export const studyWithDynamicDataSchema = studyRowSchema.extend({
  registrations_count: z.number(),
  contributions_count: z.number(),
  consultants_count: z.number(),
  dynamic_funding: z.number(),
});

export type StudyWithDynamicData = z.infer<typeof studyWithDynamicDataSchema>;
export const studyWithDynamicDataArraySchema = z.array(studyWithDynamicDataSchema);

// ==========================================
// AdminConsultants Schemas
// ==========================================

export const consultantWithRelationsSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  status: z.string().nullable(),
  role: z.string(),
  max_participants: z.number().nullable(),
  created_at: z.string(),
  approved_at: z.string().nullable(),
  study: z.object({
    id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    code: z.string().nullable(),
  }).nullable(),
  partner: z.object({
    id: z.string().uuid().nullable(),
    display_name: z.string(),
    business_name: z.string().nullable(),
    city: z.string(),
    is_production_provider: z.boolean(),
    email: z.string().nullable(),
  }).nullable(),
});

export type ConsultantWithRelations = z.infer<typeof consultantWithRelationsSchema>;
export const consultantWithRelationsArraySchema = z.array(consultantWithRelationsSchema);

export const studyDropdownSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
});

export const studyDropdownArraySchema = z.array(studyDropdownSchema);

// ==========================================
// AdminContributions Schemas
// ==========================================

// Flat structure matching get_study_contributions_admin RPC
export const contributionWithStudySchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  user_id: z.string().uuid(),
  contribution_type: z.string(),
  amount: z.number(),
  currency: z.string(),
  token_type: z.string().nullable(),
  message: z.string().nullable(),
  is_anonymous: z.boolean(),
  status: z.string(),
  stripe_payment_intent_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  study_name: z.string(),
  study_code: z.string(),
  user_display_name: z.string(),
});

export type ContributionWithStudy = z.infer<typeof contributionWithStudySchema>;
export const contributionWithStudyArraySchema = z.array(contributionWithStudySchema);

export const studyWithFundingGoalSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  funding_goal: z.number().nullable(),
});

export const studyWithFundingGoalArraySchema = z.array(studyWithFundingGoalSchema);

// ==========================================
// StudyConsentItems Schemas
// ==========================================

export const studyConsentItemSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid().nullable(),
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

export type StudyConsentItemRow = z.infer<typeof studyConsentItemSchema>;
export const studyConsentItemArraySchema = z.array(studyConsentItemSchema);

export const studyQuestionnaireSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  description_key: z.string().nullable(),
  display_order: z.number(),
  ends_after_days: z.number().nullable(),
  frequency_days: z.number().nullable(),
  frequency_type: z.string().nullable(),
  is_active: z.boolean(),
  is_required: z.boolean(),
  questionnaire_code: z.string().nullable(),
  questionnaire_id: z.string().uuid().nullable(),
  questionnaire_name: z.string().nullable(),
  questionnaire_type: z.string(),
  starts_after_days: z.number().nullable(),
  study_id: z.string().uuid(),
  title_key: z.string().nullable(),
  token_reward: z.number().nullable(),
  updated_at: z.string(),
});

export type StudyQuestionnaireRow = z.infer<typeof studyQuestionnaireSchema>;
export const studyQuestionnaireArraySchema = z.array(studyQuestionnaireSchema);
