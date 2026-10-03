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
 * Prompt-caching (odysseus G1): a request that re-sends a stable prefix pays the
 * discounted `cachedInputPer1M` rate (registry `cached_input_price_per_m`, ~−90 %)
 * for the cache-READ tokens, and a small premium `cacheWritePer1M` for cache-WRITE
 * (creation) tokens. Anthropic reports `input_tokens` already EXCLUDING cache reads
 * and writes, so the three token classes are additive — see {@link CacheTokenUsage}.
 * When a discounted/premium rate is not known we fall back to `inputPer1M` (we never
 * invent a favourable discount; the registry supplies the real cached rate).
 *
 * Usage:
 *   const aggregator = createCostAggregator();
 *   aggregator.record("gpt-4o", "main_agent", 1200, 350);
 *   aggregator.record("claude", "main_agent", 800, 200, { read: 4000, write: 0 });
 *   const summary = aggregator.getSummary();
 *
 * @module
 */

// =============================================================================
// Pricing Resolution — env-based, no hardcoded model names
// =============================================================================

/** Pricing entry: input and output cost per 1M tokens (+ optional cache rates). */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  /**
   * Prompt-cache READ rate per 1M tokens (Anthropic ~10 % of input). Optional —
   * when absent, cache-read tokens fall back to the full `inputPer1M` rate so we
   * never fabricate a discount. Supply from registry `cached_input_price_per_m`
   * to realise the ~−90 % cost report.
   */
  cachedInputPer1M?: number;
  /**
   * Prompt-cache WRITE (creation) rate per 1M tokens (Anthropic ~125 % of input).
   * Optional — falls back to `inputPer1M` when absent.
   */
  cacheWritePer1M?: number;
}

/** Conservative default for models not found in the pricing table. */
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 3.00, outputPer1M: 15.00 };

/**
 * Prompt-cache token counts for a single call. Additive to `inputTokens`, which
 * (Anthropic semantics) already EXCLUDES these — so total input billed =
 * inputTokens·input + read·cachedInput + write·cacheWrite.
 */
export interface CacheTokenUsage {
  /** Cache-READ tokens (Anthropic `cache_read_input_tokens`) — billed at the cached rate. */
  read?: number;
  /** Cache-WRITE/creation tokens (Anthropic `cache_creation_input_tokens`) — billed at the write rate. */
  write?: number;
}

/**
 * Load model pricing table from AISHA_MODEL_PRICING environment variable.
 *
 * Expected JSON format:
 * ```json
 * {
 *   "gpt-4o": { "inputPer1M": 2.50, "outputPer1M": 10.00 },
 *   "claude-*": { "inputPer1M": 3.00, "outputPer1M": 15.00, "cachedInputPer1M": 0.30, "cacheWritePer1M": 3.75 },
 *   "ollama-*": { "inputPer1M": 0, "outputPer1M": 0 }
 * }
 * ```
 *
 * Wildcard entries ending with `-*` match model name prefixes. `cachedInputPer1M`
 * and `cacheWritePer1M` are optional. Returns empty table if env var is not set or
 * contains invalid JSON.
 */
export function loadPricingFromEnv(): Record<string, ModelPricing> {
  try {
    const raw = process.env.AISHA_MODEL_PRICING;
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
          const entry: ModelPricing = { inputPer1M: v.inputPer1M, outputPer1M: v.outputPer1M };
          // Optional prompt-cache rates — only adopt real numbers (never invent).
          if (typeof v.cachedInputPer1M === "number") entry.cachedInputPer1M = v.cachedInputPer1M;
          if (typeof v.cacheWritePer1M === "number") entry.cacheWritePer1M = v.cacheWritePer1M;
          result[key] = entry;
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Shape of one entry from the `get_model_pricing()` RPC (keyed by model_id). */
export interface RegistryModelPrice {
  input_per_m: number | null;
  output_per_m: number | null;
  cached_input_per_m: number | null;
  provider?: string;
}

/**
 * Build a pricing table from the registry `get_model_pricing()` RPC output, carrying
 * `cached_input_per_m` so cache hits bill at the real (~−90 %) rate instead of the
 * flat DEFAULT_PRICING. Inject via `createCostAggregator({ pricingTable })` (and the
 * caller may also set it as the shared estimator's table). Entries without a usable
 * numeric input+output price are skipped (the DB catalog prices those instead).
 */
export function pricingTableFromRegistry(
  rows: Record<string, RegistryModelPrice> | null | undefined,
): Record<string, ModelPricing> {
  const table: Record<string, ModelPricing> = {};
  if (!rows) return table;
  for (const [modelId, p] of Object.entries(rows)) {
    if (p == null || typeof p.input_per_m !== "number" || typeof p.output_per_m !== "number") {
      continue;
    }
    const entry: ModelPricing = { inputPer1M: p.input_per_m, outputPer1M: p.output_per_m };
    if (typeof p.cached_input_per_m === "number") entry.cachedInputPer1M = p.cached_input_per_m;
    table[modelId] = entry;
  }
  return table;
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
  /** Prompt-cache READ tokens billed at the cached rate (0 when caching unused). */
  cacheReadTokens: number;
  /** Prompt-cache WRITE/creation tokens (0 when caching unused). */
  cacheCreationTokens: number;
  callCount: number;
  costUsd: number;
}

/** Usage record for a single agent. */
export interface AgentUsage {
  agent: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  callCount: number;
  costUsd: number;
}

/** Complete cost summary for a run. */
export interface CostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Total prompt-cache READ tokens across the run (visibility into cache hits). */
  totalCacheReadTokens: number;
  /** Total prompt-cache WRITE tokens across the run. */
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  totalCalls: number;
  byModel: ModelUsage[];
  byAgent: AgentUsage[];
}

/** Cost aggregator instance. */
export interface CostAggregator {
  /**
   * Record a single LLM call's token usage. `cache` carries prompt-cache read/write
   * counts (additive to inputTokens); omit it for non-cached calls (unchanged behaviour).
   */
  record(
    model: string,
    agent: string,
    inputTokens: number,
    outputTokens: number,
    cache?: CacheTokenUsage,
  ): void;
  /** Get the aggregated cost summary. */
  getSummary(): CostSummary;
  /** Get cost estimate for specific tokens on a model (without recording). */
  estimateCost(model: string, inputTokens: number, outputTokens: number, cache?: CacheTokenUsage): number;
}

// =============================================================================
// Factory
// =============================================================================

/** Options for creating a cost aggregator instance. */
export interface CostAggregatorOptions {
  /** Pre-loaded pricing table. Falls back to AISHA_MODEL_PRICING env if not provided. */
  pricingTable?: Record<string, ModelPricing>;
}

interface MutableUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  callCount: number;
  costUsd: number;
}

/**
 * Create a new cost aggregator instance for tracking a single run.
 *
 * Pricing resolution: options.pricingTable → AISHA_MODEL_PRICING env → DEFAULT_PRICING.
 * Thread-safe within a single Deno isolate (no concurrent mutation).
 */
export function createCostAggregator(options?: CostAggregatorOptions): CostAggregator {
  const pricing = options?.pricingTable ?? loadPricingFromEnv();
  const modelMap = new Map<string, MutableUsage>();
  const agentMap = new Map<string, MutableUsage>();

  function computeCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cache?: CacheTokenUsage,
  ): number {
    const p = getPricing(pricing, model);
    // No invented discount: fall back to the full input rate when a cache rate is
    // unknown. The registry's cached_input_price_per_m supplies the real ~−90 % rate.
    const cachedRate = p.cachedInputPer1M ?? p.inputPer1M;
    const writeRate = p.cacheWritePer1M ?? p.inputPer1M;
    const readTokens = Math.max(0, cache?.read ?? 0);
    const writeTokens = Math.max(0, cache?.write ?? 0);
    return (
      inputTokens * p.inputPer1M +
      outputTokens * p.outputPer1M +
      readTokens * cachedRate +
      writeTokens * writeRate
    ) / 1_000_000;
  }

  function accumulate(map: Map<string, MutableUsage>, key: string, add: MutableUsage): void {
    const existing = map.get(key);
    if (existing) {
      existing.inputTokens += add.inputTokens;
      existing.outputTokens += add.outputTokens;
      existing.cacheReadTokens += add.cacheReadTokens;
      existing.cacheCreationTokens += add.cacheCreationTokens;
      existing.callCount += add.callCount;
      existing.costUsd += add.costUsd;
    } else {
      map.set(key, { ...add });
    }
  }

  return {
    record(
      model: string,
      agent: string,
      inputTokens: number,
      outputTokens: number,
      cache?: CacheTokenUsage,
    ): void {
      const cost = computeCost(model, inputTokens, outputTokens, cache);
      const entry: MutableUsage = {
        inputTokens,
        outputTokens,
        cacheReadTokens: Math.max(0, cache?.read ?? 0),
        cacheCreationTokens: Math.max(0, cache?.write ?? 0),
        callCount: 1,
        costUsd: cost,
      };
      accumulate(modelMap, model, entry);
      accumulate(agentMap, agent, entry);
    },

    getSummary(): CostSummary {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheReadTokens = 0;
      let totalCacheCreationTokens = 0;
      let totalCostUsd = 0;
      let totalCalls = 0;

      const byModel: ModelUsage[] = [];
      for (const [model, usage] of modelMap) {
        byModel.push({ model, ...usage });
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
        totalCacheReadTokens += usage.cacheReadTokens;
        totalCacheCreationTokens += usage.cacheCreationTokens;
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
        totalCacheReadTokens,
        totalCacheCreationTokens,
        totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000, // 6 decimal precision
        totalCalls,
        byModel,
        byAgent,
      };
    },

    estimateCost(
      model: string,
      inputTokens: number,
      outputTokens: number,
      cache?: CacheTokenUsage,
    ): number {
      return computeCost(model, inputTokens, outputTokens, cache);
    },
  };
}

// =============================================================================
// Shared estimator — single pricing-resolved instance for one-off cost lookups
// =============================================================================

let sharedEstimator: CostAggregator | null = null;

/**
 * Estimate the USD cost of a single LLM call without standing up an aggregator.
 *
 * Backs the canonical `ai_runs.cost_total_json.total_usd` persisted by appendCost:
 * pricing resolves via the same AISHA_MODEL_PRICING chain (no hardcoded models).
 * `cache` bills prompt-cache read/write tokens at the cached/write rate (odysseus
 * G1); omit it for the original behaviour. Returns 0 for empty/unpriceable input.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache?: CacheTokenUsage,
): number {
  const read = Math.max(0, cache?.read ?? 0);
  const write = Math.max(0, cache?.write ?? 0);
  if (!model || (inputTokens <= 0 && outputTokens <= 0 && read <= 0 && write <= 0)) return 0;
  if (!sharedEstimator) sharedEstimator = createCostAggregator();
  return sharedEstimator.estimateCost(model, Math.max(0, inputTokens), Math.max(0, outputTokens), {
    read,
    write,
  });
}
