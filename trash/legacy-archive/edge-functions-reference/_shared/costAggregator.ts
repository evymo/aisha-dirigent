/**
 * Cost Aggregator — Per-model, per-agent cost tracking for AISHA runs.
 *
 * Tracks token usage and estimated USD cost broken down by model and agent.
 * Inspired by Claude Code's cost-tracker pattern but adapted for AISHA's
 * multi-agent workflow engine and Langfuse-backed tracing.
 *
 * Pricing resolution chain (first match wins):
 *   1. Pricing table injected via createCostAggregator({ pricingTable })
 *   2. AISHA_MODEL_PRICING env var (JSON Record<string, {inputPer1M, outputPer1M}>)
 *   3. DEFAULT_PRICING fallback ($3/$15 per 1M tokens) for unknown models
 *
 * No hardcoded model names — pricing is data, loaded from env configuration.
 *
 * Usage:
 *   const aggregator = createCostAggregator();
 *   aggregator.record("gpt-4o", "main_agent", 1200, 350);
 *   const summary = aggregator.getSummary();
 *
 * @module
 */

// =============================================================================
// Pricing Resolution — env-based, no hardcoded model names
// =============================================================================

/** Pricing entry: input and output cost per 1M tokens. */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/** Conservative default for models not found in the pricing table. */
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 3.00, outputPer1M: 15.00 };

/**
 * Load model pricing table from AISHA_MODEL_PRICING environment variable.
 *
 * Expected JSON format:
 * ```json
 * {
 *   "gpt-4o": { "inputPer1M": 2.50, "outputPer1M": 10.00 },
 *   "ollama-*": { "inputPer1M": 0, "outputPer1M": 0 }
 * }
 * ```
 *
 * Wildcard entries ending with `-*` match model name prefixes.
 * Returns empty table if env var is not set or contains invalid JSON.
 */
export function loadPricingFromEnv(): Record<string, ModelPricing> {
  try {
    const raw = Deno.env.get("AISHA_MODEL_PRICING");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, ModelPricing> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (
        val != null &&
        typeof val === "object" &&
        "inputPer1M" in val &&
        "outputPer1M" in val
      ) {
        const v = val as Record<string, unknown>;
        if (typeof v.inputPer1M === "number" && typeof v.outputPer1M === "number") {
          result[key] = { inputPer1M: v.inputPer1M, outputPer1M: v.outputPer1M };
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Look up pricing for a model string in the given pricing table.
 * Tries exact match first, then prefix match for wildcard entries (e.g. "ollama-*").
 * Falls back to DEFAULT_PRICING for models not in the table.
 */
function getPricing(pricingTable: Record<string, ModelPricing>, model: string): ModelPricing {
  // Exact match
  if (pricingTable[model]) return pricingTable[model];

  // Prefix match (e.g. "ollama-llama3" matches "ollama-*")
  const lower = model.toLowerCase();
  for (const [pattern, pricing] of Object.entries(pricingTable)) {
    if (pattern.endsWith("-*")) {
      const prefix = pattern.slice(0, -1); // "ollama-"
      if (lower.startsWith(prefix)) return pricing;
    }
  }

  return DEFAULT_PRICING;
}

// =============================================================================
// Types
// =============================================================================

/** Usage record for a single model. */
export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costUsd: number;
}

/** Usage record for a single agent. */
export interface AgentUsage {
  agent: string;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costUsd: number;
}

/** Complete cost summary for a run. */
export interface CostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalCalls: number;
  byModel: ModelUsage[];
  byAgent: AgentUsage[];
}

/** Cost aggregator instance. */
export interface CostAggregator {
  /** Record a single LLM call's token usage. */
  record(model: string, agent: string, inputTokens: number, outputTokens: number): void;
  /** Get the aggregated cost summary. */
  getSummary(): CostSummary;
  /** Get cost estimate for specific tokens on a model (without recording). */
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
}

// =============================================================================
// Factory
// =============================================================================

/** Options for creating a cost aggregator instance. */
export interface CostAggregatorOptions {
  /** Pre-loaded pricing table. Falls back to AISHA_MODEL_PRICING env if not provided. */
  pricingTable?: Record<string, ModelPricing>;
}

/**
 * Create a new cost aggregator instance for tracking a single run.
 *
 * Pricing resolution: options.pricingTable → AISHA_MODEL_PRICING env → DEFAULT_PRICING.
 * Thread-safe within a single Deno isolate (no concurrent mutation).
 */
export function createCostAggregator(options?: CostAggregatorOptions): CostAggregator {
  const pricing = options?.pricingTable ?? loadPricingFromEnv();
  const modelMap = new Map<string, { inputTokens: number; outputTokens: number; callCount: number; costUsd: number }>();
  const agentMap = new Map<string, { inputTokens: number; outputTokens: number; callCount: number; costUsd: number }>();

  function computeCost(model: string, inputTokens: number, outputTokens: number): number {
    const p = getPricing(pricing, model);
    return (inputTokens * p.inputPer1M + outputTokens * p.outputPer1M) / 1_000_000;
  }

  return {
    record(model: string, agent: string, inputTokens: number, outputTokens: number): void {
      const cost = computeCost(model, inputTokens, outputTokens);

      // Aggregate by model
      const existing = modelMap.get(model);
      if (existing) {
        existing.inputTokens += inputTokens;
        existing.outputTokens += outputTokens;
        existing.callCount += 1;
        existing.costUsd += cost;
      } else {
        modelMap.set(model, { inputTokens, outputTokens, callCount: 1, costUsd: cost });
      }

      // Aggregate by agent
      const agentEntry = agentMap.get(agent);
      if (agentEntry) {
        agentEntry.inputTokens += inputTokens;
        agentEntry.outputTokens += outputTokens;
        agentEntry.callCount += 1;
        agentEntry.costUsd += cost;
      } else {
        agentMap.set(agent, { inputTokens, outputTokens, callCount: 1, costUsd: cost });
      }
    },

    getSummary(): CostSummary {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;
      let totalCalls = 0;

      const byModel: ModelUsage[] = [];
      for (const [model, usage] of modelMap) {
        byModel.push({ model, ...usage });
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
        totalCostUsd += usage.costUsd;
        totalCalls += usage.callCount;
      }

      const byAgent: AgentUsage[] = [];
      for (const [agent, usage] of agentMap) {
        byAgent.push({ agent, ...usage });
      }

      // Sort by cost descending
      byModel.sort((a, b) => b.costUsd - a.costUsd);
      byAgent.sort((a, b) => b.costUsd - a.costUsd);

      return {
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000, // 6 decimal precision
        totalCalls,
        byModel,
        byAgent,
      };
    },

    estimateCost(model: string, inputTokens: number, outputTokens: number): number {
      return computeCost(model, inputTokens, outputTokens);
    },
  };
}
