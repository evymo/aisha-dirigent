/**
 * Admin Core Schemas — shared profiles, roles, questionnaires, translations, helpers
 */

import { z } from "zod";
import { safeError } from "@/lib/security/safeLogger";

// ==========================================
// Profile Schemas (shared across admin pages)
// ==========================================

export const adminProfileRowSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

export type AdminProfileRow = z.infer<typeof adminProfileRowSchema>;

// ==========================================
// AdminRoles Schemas
// ==========================================

export const appRoleSchema = z.enum([
  "admin", 
  "staff", 
  "practitioner", 
  "member", 
  "evaluator", 
  "partner",
  "consultant",
  "researcher",
  "production_operator",
  "production_supervisor",
  "quality_manager"
]);

export type AppRole = z.infer<typeof appRoleSchema>;

export const userRoleAdminRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: appRoleSchema,
  granted_at: z.string(),
  granted_by: z.string().uuid().nullable(),
  profile_email: z.string().nullable().optional(),
  profile_display_name: z.string().nullable().optional(),
});

export type UserRoleAdminRow = z.infer<typeof userRoleAdminRowSchema>;

export const userRoleAdminArraySchema = z.array(userRoleAdminRowSchema);

// ==========================================
// AdminQuestionnaires Schemas
// ==========================================

export const questionOptionSchema = z.object({
  value: z.string(),
  label: z.union([z.string(), z.record(z.string())]).optional(),
  labelKey: z.string().optional(),
});

export const questionSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["text", "textarea", "number", "select", "radio", "checkbox", "scale", "date", "tags", "feeling_preset", "boolean"]),
  text: z.union([z.string(), z.record(z.string())]).optional(),
  textKey: z.string().optional(),
  description: z.union([z.string(), z.record(z.string())]).optional(),
  descriptionKey: z.string().optional(),
  required: z.boolean().optional(),
  order: z.number().optional(),
  options: z.array(questionOptionSchema).optional(),
  scaleLabels: z.array(questionOptionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export type Question = z.infer<typeof questionSchema>;

export const questionArraySchema = z.array(questionSchema);

// ==========================================
// Translation RPC Schemas
// ==========================================

export const translationRowSchema = z.object({
  key: z.string(),
  locale: z.string(),
  value: z.string(),
});

export type TranslationRow = z.infer<typeof translationRowSchema>;

export const translationRowArraySchema = z.array(translationRowSchema);

// ==========================================
// Helper functions for safe parsing
// ==========================================

/**
 * Safely parse RPC response with Zod schema.
 * Returns parsed data or throws with descriptive error.
 */
export function parseRpcResponse<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    safeError(`[Zod] Validation failed for ${context}`, result.error.issues);
    throw new Error(`Invalid data structure in ${context}`);
  }
  return result.data;
}

/**
 * Safely parse array RPC response, returning empty array on null/undefined.
 */
export function parseArrayResponse<T>(schema: z.ZodType<T[]>, data: unknown, context: string): T[] {
  if (!data) return [];
  return parseRpcResponse(schema, data, context);
}
