/**
 * Zod validation schemas for hook RPC responses
 * 
 * These schemas provide type-safe runtime validation of RPC responses
 * used in custom hooks throughout the application.
 */

import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { z } from "zod";
import { safeError } from "@/lib/security/safeLogger";

// ==========================================
// Membership Schemas
// ==========================================

export const membershipSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  tier: z.enum(["basic", "upgraded", "trial"]),
  status: z.enum(["active", "expired", "cancelled", "pending"]),
  payment_type: z.enum(["one_time", "recurring"]),
  subscription_period: z.enum(["monthly", "quarterly", "annual"]).nullable(),
  stripe_subscription_id: z.string().nullable(),
  stripe_customer_id: z.string().nullable(),
  starts_at: z.string(),
  expires_at: z.string().nullable(),
  auto_renew: z.boolean().nullable(),
  tokens_aisha: z.number().nullable(),
  tokens_governance: z.number().nullable(),
  tokens_impact: z.number().nullable(),
  tokens_data: z.number().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type MembershipRpc = z.infer<typeof membershipSchema>;

export const subscriptionPackageSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  tier: z.enum(["basic", "upgraded", "trial"]),
  period: z.enum(["monthly", "quarterly", "annual"]),
  price: z.number().optional().default(0),
  currency: z.string().optional().default(BASE_CURRENCY_FALLBACK),
  is_recurring: z.boolean(),
  stripe_price_id: z.string().nullable(),
  includes_products: z.array(z.string()).nullable(),
  includes_diagnostics: z.array(z.string()).nullable(),
  governance_tokens: z.number(),
  impact_tokens: z.number(),
  is_active: z.boolean(),
  sort_order: z.number(),
});

export type SubscriptionPackageRpc = z.infer<typeof subscriptionPackageSchema>;

export const subscriptionPackageArraySchema = z.array(subscriptionPackageSchema);

// ==========================================
// Cart Schemas
// ==========================================

export const cartItemRpcSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  quantity: z.number(),
  product_name: z.string(),
  product_price: z.number(),
  product_image_url: z.string().nullable(),
  product_slug: z.string(),
});

export type CartItemRpc = z.infer<typeof cartItemRpcSchema>;

export const cartItemArraySchema = z.array(cartItemRpcSchema);

// ==========================================
// Session Management Schemas
// ==========================================

export const activeSessionSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  last_active_at: z.string(),
  user_agent: z.string().nullable(),
  ip_address: z.string().nullable().optional(),
});

export type ActiveSessionRpc = z.infer<typeof activeSessionSchema>;

export const activeSessionArraySchema = z.array(activeSessionSchema);

// ==========================================
// Partner Appointment Schemas
// ==========================================

export const partnerAppointmentSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  member_id: z.string().uuid(),
  appointment_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  appointment_type: z.string(),
  status: z.string(),
  service: z.string().nullable(),
  notes: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  member_profile: z.object({
    display_name: z.string().nullable(),
    email: z.string().nullable(),
  }).nullable().optional(),
});

export type PartnerAppointmentRpc = z.infer<typeof partnerAppointmentSchema>;

export const partnerAppointmentArraySchema = z.array(partnerAppointmentSchema);

// ==========================================
// Operational Assessment Schemas
// ==========================================

export const operationalAssessmentDimensionSchema = z.object({
  dimension: z.string(),
  score: z.number(),
  label: z.string().optional(),
});

export const operationalAssessmentSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  assessment_type: z.string(),
  status: z.string(),
  overall_score: z.number().nullable(),
  dimensions: z.array(operationalAssessmentDimensionSchema).nullable(),
  interpretation: z.string().nullable(),
  alert_flags: z.array(z.string()).nullable(),
  has_critical_flags: z.boolean().nullable(),
  trend_vs_baseline: z.number().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type OperationalAssessmentRpc = z.infer<typeof operationalAssessmentSchema>;

export const operationalAssessmentArraySchema = z.array(operationalAssessmentSchema);

// ==========================================
// Helper functions for safe parsing
// ==========================================

/**
 * Safely parse RPC response with Zod schema.
 * Returns parsed data or null on failure (logs error).
 */
export function parseRpcResponseSafe<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    safeError(`[Zod] Validation failed for ${context}`, result.error.issues);
    return null;
  }
  return result.data;
}

/**
 * Safely parse array RPC response, returning empty array on null/undefined or validation failure.
 */
export function parseArrayResponseSafe<T>(
  schema: z.ZodType<T[]>,
  data: unknown,
  context: string
): T[] {
  if (!data) return [];
  const result = schema.safeParse(data);
  if (!result.success) {
    safeError(`[Zod] Array validation failed for ${context}`, result.error.issues);
    return [];
  }
  return result.data;
}

/**
 * Parse first item from RPC array response, returning null if empty or invalid.
 */
export function parseFirstItemSafe<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string
): T | null {
  if (!data) return null;
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length === 0) return null;
  return parseRpcResponseSafe(schema, arr[0], context);
}
