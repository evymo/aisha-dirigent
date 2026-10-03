/**
 * Zod schemas for subscriptions
 * 
 * @module lib/schemas/subscriptionSchemas
 */

import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { z } from "zod";

/**
 * Schema for subscription RPC response row
 */
export const subscriptionRpcRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  package_id: z.string().uuid().nullable(),
  amount_paid: z.number(),
  currency: z.string().optional().default(BASE_CURRENCY_FALLBACK),
  status: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  created_at: z.string(),
  package_name: z.string().nullable(),
  package_tier: z.string().nullable(),
  package_period: z.string().nullable(),
  tokens_governance: z.number().nullable().optional(),
  tokens_impact: z.number().nullable().optional(),
  tokens_data: z.number().nullable().optional(),
  governance_tokens: z.number().nullable().optional(),
  impact_tokens: z.number().nullable().optional(),
});

export const subscriptionRpcArraySchema = z.array(subscriptionRpcRowSchema);

export type SubscriptionRpcRow = z.infer<typeof subscriptionRpcRowSchema>;
