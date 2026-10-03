import { z } from "zod";

/**
 * Zod schema for cost_json field in ai_trace_events.
 * Enforces consistent structure for cost tracking across all AI operations.
 */
export const costJsonSchema = z.object({
  /** Input tokens consumed. */
  tokens_in: z.number().int().min(0),
  /** Output tokens generated. */
  tokens_out: z.number().int().min(0),
  /** Total cost in USD for this operation. */
  usd: z.number().min(0),
}).nullable();

/** TypeScript type inferred from costJsonSchema. */
export type CostJson = z.infer<typeof costJsonSchema>;
