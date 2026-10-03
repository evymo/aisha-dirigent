/**
 * Zod schemas for improvement_proposals domain.
 *
 * @module lib/schemas/improvementProposalSchemas
 */

import { z } from "zod";

/** Schema for a single improvement proposal row (from list_improvement_proposals_admin) */
export const improvementProposalRowSchema = z.object({
  agent_slug: z.string(),
  anomaly_key: z.string().nullable(),
  applied_at: z.string().nullable(),
  category: z.string(),
  created_at: z.string(),
  current_value: z.record(z.unknown()).nullable(),
  description: z.string(),
  id: z.string().uuid(),
  metadata: z.record(z.unknown()).nullable(),
  priority: z.number().int(),
  proposal_type: z.string(),
  proposed_value: z.record(z.unknown()).nullable(),
  review_note: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().uuid().nullable(),
  risk_level: z.string(),
  status: z.string(),
  title: z.string(),
  updated_at: z.string(),
});

/** Array schema for improvement proposals */
export const improvementProposalArraySchema = z.array(improvementProposalRowSchema);

/** TypeScript type for a single improvement proposal */
export type ImprovementProposalRow = z.infer<typeof improvementProposalRowSchema>;

/** Schema for cost simulation result row (from simulate_model_tier_cost) */
export const costSimulationResultSchema = z.object({
  model: z.string(),
  tier: z.string(),
  monthly_calls: z.number().int(),
  avg_tokens_in: z.number(),
  avg_tokens_out: z.number(),
  cost_per_call: z.number(),
  monthly_cost: z.number(),
  quality_score: z.number().nullable().optional(),
});

/** Array schema for cost simulation results */
export const costSimulationArraySchema = z.array(costSimulationResultSchema);

/** TypeScript type for a cost simulation result */
export type CostSimulationResult = z.infer<typeof costSimulationResultSchema>;
