/**
 * Zod schemas for distribution protocols
 * 
 * @module lib/schemas/distributionSchemas
 */

import { z } from "zod";

/**
 * Schema for effective distribution from RPC
 */
export const effectiveDistributionSchema = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  protocol_id: z.string().uuid(),
  protocol_name: z.string(),
  dose_amount: z.number(),
  dose_unit: z.string(),
  doses_per_day: z.number(),
  dose_timing: z.array(z.string()),
  arm_code: z.string().nullable(),
  source: z.enum(["study", "adjustment", "default"]),
  study_name: z.string().nullable(),
  ml_per_day: z.number(),
  ml_per_month: z.number(),
  bottle_lasts_days: z.number(),
});

export const effectiveDistributionArraySchema = z.array(effectiveDistributionSchema);

/**
 * Schema for distribution protocol
 */
export const distributionProtocolSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  dose_amount: z.number(),
  dose_unit: z.string(),
  doses_per_day: z.number(),
  dose_timing: z.array(z.string()).nullable(),
  arm_code: z.string().nullable(),
  product_id: z.string().uuid().nullable(),
  product_name: z.string().nullable(),
  study_id: z.string().uuid().nullable(),
  study_name: z.string().nullable(),
});

/**
 * Schema for distribution plan from RPC
 */
export const distributionPlanSchema = z.object({
  id: z.string().uuid(),
  protocol_id: z.string().uuid(),
  protocol: distributionProtocolSchema.nullable(),
  custom_dose_amount: z.number().nullable(),
  custom_doses_per_day: z.number().nullable(),
  custom_instructions: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  status: z.string(),
  compliance_target: z.number(),
  compensation_percentage: z.number(),
  is_vip: z.boolean(),
});

export const distributionPlanArraySchema = z.array(distributionPlanSchema);

export type EffectiveDistributionRow = z.infer<typeof effectiveDistributionSchema>;
export type DistributionPlanRow = z.infer<typeof distributionPlanSchema>;
