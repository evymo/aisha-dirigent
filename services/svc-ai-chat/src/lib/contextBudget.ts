/**
 * impl 03 (odysseus) — context budget: pure functions.
 *
 * The budget DATA has flowed for a while (ai_model_registry.context_window /
 * max_output_tokens exist; compose_context fills ContextBundle.tokenBudget /
 * tokensUsed) — nothing ENFORCED it. This module is the enforcement math; the
 * wiring lives in chat.ts + orchestrationBridge behind the
 * ADAPTIVE_CONTEXT_BUDGET flag (default off until window backfill, impl/07).
 *
 * Guardrails baked in (impl/09):
 *  - B-2: unknown/NULL context window → null budget → PARITY (today's
 *    behavior, no aggressive trimming). Budget applies only where the window
 *    is actually known.
 *  - B-3: headroom default 0.7 (not 0.85) — estimateTokens is chars/4 and
 *    underestimates code/JSON/CJK; the margin absorbs that.
 *  - governance survives budget pressure: ruleset + project_context layers
 *    are never dropped by the bundle trimmer; memory events and KB chunk
 *    TAILS (lowest relevance) go first.
 *
 * Token estimation intentionally reuses the platform's existing conservative
 * estimator shape (Math.ceil(chars/4), same as svc-mcp-knowledge
 * knowledge-embeddings + spendEstimate) — no tokenizer dependency (impl/08 §0).
 */

export interface ChatHistoryMessage {
  role: string;
  content: string;
}

/** Conservative token estimate — chars/4, rounded up. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Per-message wrapper overhead (role/framing tokens) on top of content. */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

/** Estimate tokens for a message array (content + per-message overhead). */
export function estimateMessagesTokens(messages: ReadonlyArray<ChatHistoryMessage>): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content) + PER_MESSAGE_OVERHEAD_TOKENS;
  return total;
}

export interface ComputeInputBudgetArgs {
  /** Model context window from ai_model_registry (null/undefined = unknown). */
  contextWindow: number | null | undefined;
  /** Reserved output tokens (model max_output_tokens or the agent max_tokens). */
  maxOutputTokens: number | null | undefined;
  /** Fraction of the window usable for input (ai_runtime.context_budget_headroom). */
  headroom: number;
  /** Absolute ceiling regardless of window (ai_runtime.context_budget_hard_max). */
  hardMax: number;
}

/**
 * Input-token budget for a model, or null when it cannot be derived safely.
 * null means: DO NOT enforce anything (parity with today's behavior).
 */
export function computeInputBudget(args: ComputeInputBudgetArgs): number | null {
  const { contextWindow, maxOutputTokens, headroom, hardMax } = args;
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  const reservedOutput = maxOutputTokens && maxOutputTokens > 0 ? maxOutputTokens : 0;
  const budget = Math.min(hardMax, Math.floor(contextWindow * headroom) - reservedOutput);
  return budget > 0 ? budget : null;
}

export interface EnforceHistoryBudgetArgs {
  history: ReadonlyArray<ChatHistoryMessage>;
  /** null budget = parity (no trimming). */
  budgetTokens: number | null;
  /** The most recent turns are always kept verbatim. */
  keepLastTurns: number;
}

export interface EnforceHistoryBudgetResult {
  kept: ChatHistoryMessage[];
  droppedCount: number;
  tokensKept: number;
}

/**
 * Trim history to the budget from the OLDEST side; the newest keepLastTurns
 * messages are always kept (the live exchange must never be dropped).
 */
export function enforceHistoryBudget(args: EnforceHistoryBudgetArgs): EnforceHistoryBudgetResult {
  const { history, budgetTokens, keepLastTurns } = args;
  const all = [...history];
  if (budgetTokens === null || budgetTokens <= 0) {
    return { kept: all, droppedCount: 0, tokensKept: estimateMessagesTokens(all) };
  }

  const mustKeep = Math.min(Math.max(1, keepLastTurns), all.length);
  const tail = all.slice(all.length - mustKeep);
  const head = all.slice(0, all.length - mustKeep);

  let tokens = estimateMessagesTokens(tail);
  const keptHead: ChatHistoryMessage[] = [];
  // Walk the head from newest to oldest, keeping while the budget allows.
  for (let i = head.length - 1; i >= 0; i--) {
    const t = estimateTokens(head[i].content) + PER_MESSAGE_OVERHEAD_TOKENS;
    if (tokens + t > budgetTokens) break;
    keptHead.unshift(head[i]);
    tokens += t;
  }

  const kept = [...keptHead, ...tail];
  return { kept, droppedCount: all.length - kept.length, tokensKept: tokens };
}

export interface ShouldCompactArgs {
  historyTokens: number;
  budgetTokens: number | null;
  /** ai_runtime.compact_threshold — fraction of budget that triggers compaction. */
  threshold: number;
}

/** Compaction triggers only above threshold × budget; null budget never triggers. */
export function shouldCompactHistory(args: ShouldCompactArgs): boolean {
  const { historyTokens, budgetTokens, threshold } = args;
  if (budgetTokens === null || budgetTokens <= 0) return false;
  return historyTokens >= budgetTokens * threshold;
}

// ============================================================================
// ContextBundle layer trimming (compose_context already reports the budget)
// ============================================================================

export interface TrimmableBundle {
  profile: string;
  tokenBudget: number;
  tokensUsed: number;
  layers: Record<string, unknown>;
}

export interface TrimBundleResult<T extends TrimmableBundle | null> {
  bundle: T;
  trimmed: boolean;
  /** Human-readable trim actions for debug/observability. */
  actions: string[];
}

/** Max memory trace events kept under budget pressure. */
const TRIMMED_MEMORY_EVENTS = 5;

/**
 * Enforce ContextBundle.tokenBudget over its layers. Trim order (never touches
 * ruleset/project_context — governance survives budget pressure):
 *   1. memory events → last TRIMMED_MEMORY_EVENTS
 *   2. KB chunks → drop from the TAIL (compose_context returns them ranked,
 *      head = most relevant) until the serialized estimate fits
 * Unknown/zero budget or within-budget bundles pass through untouched.
 */
export function trimContextBundleLayers<T extends TrimmableBundle | null>(
  bundle: T,
): TrimBundleResult<T> {
  if (!bundle || !bundle.layers) return { bundle, trimmed: false, actions: [] };
  if (!bundle.tokenBudget || bundle.tokenBudget <= 0) return { bundle, trimmed: false, actions: [] };
  if (bundle.tokensUsed <= bundle.tokenBudget) return { bundle, trimmed: false, actions: [] };

  const actions: string[] = [];
  const layers = { ...bundle.layers } as Record<string, unknown>;

  // 1. memory events → keep only the most recent few
  const mem = layers.memory as { events?: unknown[] } | undefined;
  if (mem?.events && Array.isArray(mem.events) && mem.events.length > TRIMMED_MEMORY_EVENTS) {
    layers.memory = { ...mem, events: mem.events.slice(-TRIMMED_MEMORY_EVENTS) };
    actions.push(`memory.events ${mem.events.length}→${TRIMMED_MEMORY_EVENTS}`);
  }

  // 2. KB chunks → drop the tail until the serialized layer estimate fits
  const kb = layers.kb_retrieval as { chunks?: unknown[] } | undefined;
  if (kb?.chunks && Array.isArray(kb.chunks) && kb.chunks.length > 0) {
    let chunks = [...kb.chunks];
    const fits = (): boolean =>
      estimateTokens(JSON.stringify({ ...layers, kb_retrieval: { ...kb, chunks } })) <= bundle.tokenBudget;
    while (chunks.length > 1 && !fits()) {
      chunks = chunks.slice(0, -1);
    }
    if (chunks.length < kb.chunks.length) {
      actions.push(`kb_retrieval.chunks ${kb.chunks.length}→${chunks.length}`);
    }
    layers.kb_retrieval = { ...kb, chunks };
  }

  if (actions.length === 0) return { bundle, trimmed: false, actions };

  const trimmedBundle = {
    ...bundle,
    layers,
    tokensUsed: Math.min(bundle.tokensUsed, estimateTokens(JSON.stringify(layers))),
  } as NonNullable<T>;
  return { bundle: trimmedBundle, trimmed: true, actions };
}

/**
 * Feature flag reader — default OFF, explicit opt-in with 'true'
 * (impl/07: adaptive_context_budget starts disabled until window backfill).
 */
export function isAdaptiveContextBudgetEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.ADAPTIVE_CONTEXT_BUDGET === "true";
}
