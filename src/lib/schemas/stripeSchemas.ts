/**
 * Zod validation schemas for Stripe integration RPC responses
 * 
 * These schemas provide type-safe runtime validation of Stripe-related
 * responses from edge functions and database queries.
 */

import { z } from "zod";

// ==========================================
// Payment Type Enum
// ==========================================

export const paymentTypeSchema = z.enum(["one_time", "recurring"]);
export type PaymentType = z.infer<typeof paymentTypeSchema>;

// ==========================================
// Checkout Session Schemas
// ==========================================

export const checkoutResultSchema = z.object({
  sessionId: z.string(),
  url: z.string().url(),
  subscriptionId: z.string().uuid(),
});

export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

// ==========================================
// Subscription Status Schemas
// ==========================================

export const subscriptionPackageInfoSchema = z.object({
  name: z.string(),
  tier: z.string(),
  period: z.string(),
});

export const activeSubscriptionSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  paymentType: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  nextBillingDate: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  package: subscriptionPackageInfoSchema.nullable(),
});

export const pendingSubscriptionSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  package: z.object({
    name: z.string(),
  }).nullable(),
});

export const subscriptionStatusSchema = z.object({
  hasActiveSubscription: z.boolean(),
  activeSubscription: activeSubscriptionSchema.nullable(),
  pendingSubscription: pendingSubscriptionSchema.nullable(),
  stripeCustomerId: z.string().nullable(),
});

export type ActiveSubscription = z.infer<typeof activeSubscriptionSchema>;
export type PendingSubscription = z.infer<typeof pendingSubscriptionSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

// ==========================================
// Customer Portal Schema
// ==========================================

export const customerPortalResultSchema = z.object({
  url: z.string().url(),
});

export type CustomerPortalResult = z.infer<typeof customerPortalResultSchema>;

// ==========================================
// Subscription Package with Stripe Fields Schema
// ==========================================

export const subscriptionPackageWithStripeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  tier: z.enum(["basic", "upgraded", "trial"]),
  period: z.enum(["monthly", "quarterly", "annual"]),
  price: z.number(),
  currency: z.string(),
  is_recurring: z.boolean(),
  stripe_price_id: z.string().nullable(),
  stripe_product_id: z.string().nullable(),
  stripe_price_id_one_time: z.string().nullable(),
  stripe_price_id_recurring: z.string().nullable(),
  allow_one_time_payment: z.boolean(),
  allow_recurring_payment: z.boolean(),
  min_billing_months: z.number().nullable(),
  billing_interval_months: z.number().nullable(),
  includes_products: z.array(z.string()).nullable(),
  includes_diagnostics: z.array(z.string()).nullable(),
  tokens_governance: z.number(),
  tokens_impact: z.number(),
  tokens_data: z.number(),
  is_active: z.boolean(),
  sort_order: z.number(),
});

export type SubscriptionPackageWithStripe = z.infer<typeof subscriptionPackageWithStripeSchema>;

export const subscriptionPackageWithStripeArraySchema = z.array(subscriptionPackageWithStripeSchema);

// ==========================================
// Payment Session Schema
// ==========================================

export const paymentSessionStatusSchema = z.enum([
  "pending",
  "completed", 
  "expired",
  "failed",
]);

export const paymentSessionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  subscription_id: z.string().uuid().nullable(),
  stripe_session_id: z.string(),
  payment_type: paymentTypeSchema,
  status: paymentSessionStatusSchema,
  amount_total: z.number().nullable(),
  currency: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

export type PaymentSession = z.infer<typeof paymentSessionSchema>;
export type PaymentSessionStatus = z.infer<typeof paymentSessionStatusSchema>;

// ==========================================
// Edge Function Error Response Schema
// ==========================================

export const stripeErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.string().optional(),
});

export type StripeErrorResponse = z.infer<typeof stripeErrorResponseSchema>;

// ==========================================
// My Subscription RPC Response Schema
// ==========================================

export const mySubscriptionPackageSchema = z.object({
  name: z.string(),
  tier: z.string(),
  period: z.string(),
  tokens_governance: z.number().nullable(),
  tokens_impact: z.number().nullable(),
  tokens_data: z.number().nullable(),
});

export const mySubscriptionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  package_id: z.string().uuid().nullable(),
  amount_paid: z.number(),
  status: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  created_at: z.string(),
  package: mySubscriptionPackageSchema.nullable(),
});

export type MySubscription = z.infer<typeof mySubscriptionSchema>;

export const mySubscriptionArraySchema = z.array(mySubscriptionSchema);
