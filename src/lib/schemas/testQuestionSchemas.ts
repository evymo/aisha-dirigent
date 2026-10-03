/**
 * Zod validation schemas for Test Questions RPC responses
 * 
 * @module lib/schemas/testQuestionSchemas
 */

import { z } from "zod";

// ==========================================
// Test Question Schemas (Public - no correct answer)
// ==========================================

export const testQuestionPublicSchema = z.object({
  id: z.string().uuid(),
  test_type: z.string(),
  question_order: z.number(),
  // Localized text fields from RPC
  question: z.string().optional(),
  option_a: z.string().optional(),
  option_b: z.string().optional(),
  option_c: z.string().optional(),
  option_d: z.string().nullable().optional(),
  // Original keys (kept for backward compatibility or admin reference)
  question_key: z.string().nullable().optional(),
  option_a_key: z.string().nullable().optional(),
  option_b_key: z.string().nullable().optional(),
  option_c_key: z.string().nullable().optional(),
  option_d_key: z.string().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string().optional(), // RPC might not return timestamps in localized version
  updated_at: z.string().optional(),
});

export type TestQuestionPublicRpc = z.infer<typeof testQuestionPublicSchema>;

export const testQuestionPublicArraySchema = z.array(testQuestionPublicSchema);

// ==========================================
// Test Question Schemas (Admin - includes correct answer)
// Non-nullable fields for admin (required for editing)
// ==========================================

export const testQuestionAdminSchema = z.object({
  id: z.string().uuid(),
  test_type: z.string(),
  question_order: z.number(),
  // Localized text fields
  question: z.string().optional(),
  option_a: z.string().optional(),
  option_b: z.string().optional(),
  option_c: z.string().optional(),
  option_d: z.string().nullable().optional(),
  // Original keys
  question_key: z.string(),
  option_a_key: z.string(),
  option_b_key: z.string(),
  option_c_key: z.string(),
  option_d_key: z.string().nullable().optional(),
  correct_answer: z.string(),
  is_active: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type TestQuestionAdminRpc = z.infer<typeof testQuestionAdminSchema>;

export const testQuestionAdminArraySchema = z.array(testQuestionAdminSchema);

// ==========================================
// Validate Test Answers Result Schema
// ==========================================

export const validateTestAnswersResultSchema = z.object({
  total_questions: z.number(),
  correct_count: z.number(),
  score: z.number(),
  passed: z.boolean(),
});

export type ValidateTestAnswersResult = z.infer<typeof validateTestAnswersResultSchema>;
