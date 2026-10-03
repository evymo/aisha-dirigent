/**
 * Zod schemas for operational assessments
 * 
 * @module lib/schemas/operationalAssessmentSchemas
 */

import { z } from "zod";

/**
 * Valid dimension values
 */
export const dimensionSchema = z.enum(["VIT", "ENE", "SLP", "PHY", "MET", "IMM", "PSY", "COG", "MOO"]);

/**
 * Schema for dimension score within an assessment
 */
export const assessmentDimensionScoreSchema = z.object({
  dimension: dimensionSchema,
  rawScore: z.number(),
  normalizedScore: z.number(),
  tagCount: z.number(),
  hasNegativeIndicators: z.boolean(),
  operationalFlags: z.array(z.string()),
});

/**
 * Schema for assessment history row from RPC
 */
export const assessmentHistoryRowSchema = z.object({
  id: z.string().uuid(),
  assessment_type: z.string(),
  status: z.enum(["in_progress", "completed", "abandoned"]),
  overall_score: z.number().nullable(),
  interpretation: z.string().nullable(),
  trend_vs_baseline: z.number().nullable(),
  alert_flags: z.array(z.string()).nullable(),
  has_critical_flags: z.boolean().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  dimensions: z.unknown(), // JSON blob parsed separately
});

export const assessmentHistoryRowArraySchema = z.array(assessmentHistoryRowSchema);

/**
 * Schema for latest assessment row from RPC
 */
export const latestAssessmentRowSchema = z.object({
  id: z.string().uuid(),
  assessment_type: z.string(),
  status: z.string(),
  overall_score: z.number().nullable(),
  interpretation: z.string().nullable(),
  trend_vs_baseline: z.number().nullable(),
  alert_flags: z.array(z.string()).nullable(),
  has_critical_flags: z.boolean().nullable(),
  completed_at: z.string().nullable(),
  dimensions: z.unknown(), // JSON blob parsed separately
});

export type AssessmentDimensionScore = z.infer<typeof assessmentDimensionScoreSchema>;
export type AssessmentHistoryRow = z.infer<typeof assessmentHistoryRowSchema>;
export type LatestAssessmentRow = z.infer<typeof latestAssessmentRowSchema>;
