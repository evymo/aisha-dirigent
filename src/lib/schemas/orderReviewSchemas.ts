/**
 * Zod validation schemas for Order Reviews RPC responses
 * 
 * @module lib/schemas/orderReviewSchemas
 */

import { z } from "zod";

// ==========================================
// Order Review Schema
// ==========================================

export const orderReviewSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  user_id: z.string().uuid(),
  rating: z.number().min(1).max(5),
  comment: z.string().nullable(),
  is_visible: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type OrderReviewRpc = z.infer<typeof orderReviewSchema>;

export const orderReviewArraySchema = z.array(orderReviewSchema);

// ==========================================
// Product Review Schema
// ==========================================

export const productReviewSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  user_id: z.string().uuid(),
  rating: z.number().min(1).max(5),
  comment: z.string().nullable(),
  is_visible: z.boolean(),
  is_verified_purchase: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  // Optional profile info from join
  display_name: z.string().nullable().optional(),
});

export type ProductReviewRpc = z.infer<typeof productReviewSchema>;

export const productReviewArraySchema = z.array(productReviewSchema);
