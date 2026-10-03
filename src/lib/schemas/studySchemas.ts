/**
 * Zod schemas for studies and related entities
 * 
 * @module lib/schemas/studySchemas
 */

import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { z } from "zod";

/**
 * Schema for study contribution
 */
export const studyContributionSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  user_id: z.string().uuid(),
  contribution_type: z.enum(["financial", "tokens_governance", "tokens_impact"]),
  amount: z.number(),
  currency: z.string().default(BASE_CURRENCY_FALLBACK),
  token_type: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  is_anonymous: z.boolean(),
  status: z.enum(["pending", "completed", "refunded"]).default("completed"),
  created_at: z.string(),
  description: z.string().optional(),
});

export const studyContributionArraySchema = z.array(studyContributionSchema);

/**
 * Schema for study consultant
 */
export const studyConsultantSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  role: z.enum(["consultant", "supervisor"]),
  status: z.enum(["pending", "approved", "rejected", "completed"]),
  max_participants: z.number().nullable(),
  notes: z.string().nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
  partner: z.object({
    display_name: z.string(),
    business_name: z.string().nullable(),
    city: z.string(),
    is_production_provider: z.boolean(),
  }).optional(),
});

export const studyConsultantArraySchema = z.array(studyConsultantSchema);

/**
 * Schema for study rating
 */
export const studyRatingSchema = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid(),
  registration_id: z.string().uuid().nullable(),
  user_id: z.string().uuid(),
  rating: z.number().min(1).max(5),
  comment: z.string().nullable(),
  is_visible: z.boolean(),
  created_at: z.string(),
});

export const studyRatingArraySchema = z.array(studyRatingSchema);

/**
 * Schema for minimal study row (fallback)
 */
export const minimalStudyRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  study_type: z.string(),
  target_condition: z.string().nullable(),
  products: z.array(z.string()).nullable(),
  duration_weeks: z.number().nullable(),
  target_registration: z.number().nullable(),
  current_registration: z.number().nullable(),
  is_blinded: z.boolean().nullable(),
  is_active: z.boolean().nullable(),
  is_umbrella: z.boolean().nullable().optional(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  protocol_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const minimalStudyRowArraySchema = z.array(minimalStudyRowSchema);

/**
 * Schema for extended study
 */
export const extendedStudySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  study_type: z.string(), // Changed from enum - DB may have other values
  target_condition: z.string().nullable(),
  products: z.array(z.string()).nullable(),
  duration_weeks: z.number().nullable(),
  target_registration: z.number().nullable(),
  current_registration: z.number(),
  is_blinded: z.boolean(),
  is_active: z.boolean(),
  is_umbrella: z.boolean(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  protocol_url: z.string().nullable(),
  funding_goal: z.number(),
  current_funding: z.number(),
  funding_deadline: z.string().nullable(),
  funding_status: z.string(), // Changed from enum - DB may have other values
  min_participants: z.number(),
  max_participants: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  consultant_count: z.number().optional(),
  contribution_count: z.number().optional(),
  total_contributed: z.number().optional(),
});

export const extendedStudyArraySchema = z.array(extendedStudySchema);

export type StudyContributionRow = z.infer<typeof studyContributionSchema>;
export type StudyConsultantRow = z.infer<typeof studyConsultantSchema>;
export type StudyRatingRow = z.infer<typeof studyRatingSchema>;
export type MinimalStudyRow = z.infer<typeof minimalStudyRowSchema>;
export type ExtendedStudyRow = z.infer<typeof extendedStudySchema>;
