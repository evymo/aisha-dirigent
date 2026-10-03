/**
 * Zod schemas for AISHA Learning Engine (ALE) feedback and training data.
 *
 * @module lib/schemas/ale
 */

import { z } from "zod";

// ============================================================================
// Feedback Schemas
// ============================================================================

/** Valid feedback categories. */
export const feedbackCategorySchema = z.enum([
  "general",
  "accuracy",
  "style",
  "completeness",
  "safety",
  "compliance",
]);

/** Input schema for submitting AI feedback. */
export const submitFeedbackInputSchema = z.object({
  correction_text: z.string().max(5000).optional(),
  domain_tags: z.array(z.string()).default([]),
  feedback_category: feedbackCategorySchema.default("general"),
  message_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).default({}),
  rating: z.number().int().min(-1).max(5),
  run_id: z.string().uuid().optional(),
  trace_event_id: z.string().uuid().optional(),
});

/** Response schema from submit_ai_feedback RPC. */
export const submitFeedbackResponseSchema = z.object({
  feedback_id: z.string().uuid().optional(),
  run_id: z.string().uuid().nullable().optional(),
  story_id: z.string().uuid().nullable().optional(),
  success: z.boolean(),
  trace_event_id: z.string().uuid().nullable().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

// ============================================================================
// Training Dataset Schemas
// ============================================================================

/** Valid training dataset source types. */
export const trainingSourceTypeSchema = z.enum([
  "feedback",
  "kb_extraction",
  "wiki_ingestion",
  "manual",
  "golden_example",
  "preference_pair",
]);

/** Valid training data formats. */
export const trainingFormatSchema = z.enum([
  "instruction",
  "preference_pair",
  "chat",
  "completion",
]);

/** Training dataset row schema. */
export const trainingDatasetSchema = z.object({
  created_at: z.string(),
  created_by: z.string().uuid().nullable(),
  description: z.string().nullable(),
  domain_tags: z.array(z.string()),
  format: trainingFormatSchema,
  id: z.string().uuid(),
  metadata: z.record(z.unknown()),
  name: z.string(),
  org_id: z.string().uuid().nullable(),
  quality_score_avg: z.number().nullable(),
  record_count: z.number(),
  source_type: trainingSourceTypeSchema,
  status: z.string(),
  updated_at: z.string(),
  validated_count: z.number(),
});

/** KB extraction response schema. */
export const kbExtractionResponseSchema = z.object({
  expert_rules_count: z.number(),
  inserted_count: z.number(),
  knowledge_items_count: z.number(),
  skipped_count: z.number(),
  success: z.boolean(),
});

// ============================================================================
// Exported Types
// ============================================================================

/** Input for submitting AI feedback. */
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackInputSchema>;

/** Response from submit_ai_feedback RPC. */
export type SubmitFeedbackResponse = z.infer<typeof submitFeedbackResponseSchema>;

/** Training dataset row. */
export type TrainingDataset = z.infer<typeof trainingDatasetSchema>;

/** KB extraction response. */
export type KbExtractionResponse = z.infer<typeof kbExtractionResponseSchema>;
