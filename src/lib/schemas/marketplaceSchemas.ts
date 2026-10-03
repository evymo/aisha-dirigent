/**
 * Zod schemas for Marketplace — pricing, bookings, earnings, ratings.
 *
 * @module lib/schemas/marketplaceSchemas
 */

import { z } from "zod";

// =============================================================================
// Enums
// =============================================================================

export const availabilityStatusSchema = z.enum([
  "available",
  "limited",
  "busy",
  "unavailable",
]);

export const bookingStatusSchema = z.enum([
  "pending_payment",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "disputed",
]);

export const revenueTypeSchema = z.enum(["project", "maintenance"]);

export const revenueStatusSchema = z.enum([
  "pending",
  "split_calculated",
  "settled",
  "refunded",
]);

export const splitRecipientTypeSchema = z.enum([
  "specialist",
  "knowledge_contributor",
  "platform",
]);

// =============================================================================
// Marketplace Member (from get_guild_members_marketplace)
// =============================================================================

export const marketplaceMemberSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  guild_tier: z.string().nullable(),
  bio: z.string().nullable(),
  expertise_summary: z.string().nullable(),
  avg_rating: z.number().nullable(),
  total_ratings_count: z.number().nullable(),
  completed_projects_count: z.number().nullable(),
  last_active_at: z.string().nullable(),
  accepts_online: z.boolean().nullable(),
  accepts_in_person: z.boolean().nullable(),
  hourly_rate: z.number().nullable(),
  min_block_hours: z.number().nullable(),
  block_price: z.number().nullable(),
  currency: z.string().nullable(),
  instant_booking_enabled: z.boolean().nullable(),
  availability_status: z.string().nullable(),
  response_time_hours: z.number().nullable(),
  conditions_text: z.string().nullable(),
  activity_score: z.number().nullable(),
  response_time_avg_hours: z.number().nullable(),
  acceptance_rate: z.number().nullable(),
  rules_contributed_count: z.number().nullable(),
  expertise: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      is_primary: z.boolean().nullable(),
      proficiency_level: z.string().nullable(),
    })
  ).default([]),
  relevance_score: z.number().nullable(),
});

export type MarketplaceMember = z.infer<typeof marketplaceMemberSchema>;

// =============================================================================
// Specialist Pricing
// =============================================================================

export const specialistPricingSchema = z.object({
  id: z.string().uuid(),
  partner_id: z.string().uuid(),
  hourly_rate: z.number(),
  min_block_hours: z.number(),
  max_concurrent_projects: z.number(),
  currency: z.string(),
  instant_booking_enabled: z.boolean(),
  is_active: z.boolean(),
});

export type SpecialistPricing = z.infer<typeof specialistPricingSchema>;

// =============================================================================
// Booking
// =============================================================================

export const bookingSchema = z.object({
  booking_id: z.string().uuid(),
  story_id: z.string().uuid(),
  price: z.number(),
  currency: z.string(),
});

export type BookingResult = z.infer<typeof bookingSchema>;

// =============================================================================
// Earnings
// =============================================================================

export const earningsItemSchema = z.object({
  revenue_id: z.string().uuid(),
  story_id: z.string().uuid(),
  revenue_type: z.string(),
  gross_amount: z.number(),
  my_split: z.number(),
  split_pct: z.number(),
  status: z.string(),
  created_at: z.string(),
});

export type EarningsItem = z.infer<typeof earningsItemSchema>;

export const earningsSummarySchema = z.object({
  success: z.boolean(),
  total_earned_czk: z.number(),
  total_pending_czk: z.number(),
  gross_revenue_czk: z.number(),
  total_projects: z.number(),
  items: z.array(earningsItemSchema),
});

export type EarningsSummary = z.infer<typeof earningsSummarySchema>;

// =============================================================================
// Rating
// =============================================================================

export const specialistRatingSchema = z.object({
  rating_id: z.string().uuid(),
  new_avg_rating: z.number(),
});

export type SpecialistRatingResult = z.infer<typeof specialistRatingSchema>;

// =============================================================================
// Marketplace RPC response wrapper
// =============================================================================

export const marketplaceListResponseSchema = z.object({
  items: z.array(marketplaceMemberSchema),
  total: z.number(),
});

export type MarketplaceListResponse = z.infer<typeof marketplaceListResponseSchema>;

// =============================================================================
// Generic RPC success response
// =============================================================================

export const rpcSuccessResponseSchema = z.object({
  success: z.boolean(),
});
