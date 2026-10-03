/**
 * Zod schemas for production tokens
 * 
 * @module lib/schemas/productionTokenSchemas
 */

import { z } from "zod";

/**
 * Schema for production token event from RPC
 */
export const productionTokenEventRpcSchema = z.object({
  id: z.string().uuid(),
  protocol_step_id: z.string().uuid().nullable(),
  batch_id: z.string().uuid().nullable(),
  event_type: z.enum(["mint", "burn", "lock", "unlock"]),
  token_type: z.string(),
  amount: z.number(),
  reason: z.string(),
  description: z.string().nullable(),
  reference_volume: z.number().nullable(),
  loss_volume: z.number().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  batch_code: z.string().nullable(),
  product_name: z.string().nullable(),
});

export const productionTokenEventRpcArraySchema = z.array(productionTokenEventRpcSchema);

/**
 * Schema for production token stats event
 */
export const productionTokenStatsEventSchema = z.object({
  event_type: z.string(),
  amount: z.number(),
  reference_volume: z.number().nullable(),
  loss_volume: z.number().nullable(),
});

export const productionTokenStatsEventArraySchema = z.array(productionTokenStatsEventSchema);

export type ProductionTokenEventRpc = z.infer<typeof productionTokenEventRpcSchema>;
export type ProductionTokenStatsEvent = z.infer<typeof productionTokenStatsEventSchema>;
