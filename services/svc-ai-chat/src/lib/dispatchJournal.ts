/**
 * I1 backstop journaling for model-override dispatch sites.
 *
 * Most LLM calls in svc-ai-chat already mint an `ai_decisions` row: the
 * reflection nodes via `dispatchDecision` (resolve + journal) and the
 * workflowEngine via its `journaledLlm` wrapper. But several call sites pick
 * their model themselves — from `route_task`, channel config, or a judge
 * backend — and historically dispatched a RAW `unifiedChat` with no decision
 * row, silently bypassing AISHA's authority (invariant I1 "no dispatch without
 * a journaled decision").
 *
 * `journalDispatch()` closes that gap: call it immediately before any such raw
 * dispatch so I1 holds for EVERY LLM call, not just the two reflection loops. It
 * is the same journaling primitive the loops use (`recordExecutionDecision` over
 * a `model_override` decision), extracted so the route / edge-fn surface and the
 * critic / proactive helpers can reuse it.
 *
 * Fail-closed by default: `recordExecutionDecision` throws when the durable row
 * cannot be written, so a raw model call cannot proceed with only a local UUID.
 * An explicit emergency env override exists in the writer for local experiments.
 *
 * Provider derivation uses the canonical `lib/llmRouter.ts` resolveProvider — the SINGLE
 * router. The duplicate `lib/llm-router.ts`, which mis-classified non-cloud prefixes, has
 * been removed — the former divergence is gone.
 *
 * ⛔ NAMĚŘENO 2026-09-13: „journal = dispatch vždy" platilo jen pro id s prefixem. Sedm
 * volání (evaluate ×2, story-consult ×2, v1-chat ×2, flowboard) providera, se kterým dispatchovala,
 * NEPŘEDALO; odhad `resolveProvider(model)` pak zapsal do ai_decisions jiného providera,
 * než který tokeny obsloužil (model z resolveru bez prefixu → `openai`). Volající, který
 * providera zná, ho předává VŽDY; odhad zbývá jen pro ručně psané id bez registru.
 */
import { resolveProvider, type LlmProvider } from './llmRouter.js';
import {
  recordExecutionDecision,
  toExecutionDecision,
  type AishaRuntime,
} from '../reflection/decision.js';

export interface JournalDispatchArgs {
  /** The model the call site chose (config / route_task / judge backend). */
  model: string;
  /** Provider serving the tokens; derived from the model when omitted. */
  provider?: LlmProvider;
  /** Reflection run id when one exists; null/omitted for stateless routes. */
  runId?: string | null;
  /** Story scope when the call is story-bound. */
  storyId?: string | null;
  /** Execution runtime — defaults to `direct_llm` (a plain provider call). */
  runtime?: AishaRuntime;
  /** Free-text provenance, e.g. `evaluate.message` or `story-consult.fallback`. */
  reason?: string;
}

/**
 * Journal a model-override dispatch and return its durable `decision_id`.
 * Call immediately before a raw `unifiedChat` at a site that picks its own model.
 */
export async function journalDispatch(args: JournalDispatchArgs): Promise<string> {
  const provider = args.provider ?? resolveProvider(args.model);
  return recordExecutionDecision(
    toExecutionDecision(
      { model: args.model, provider, resolution_source: 'model_override' },
      { runtime: args.runtime ?? 'direct_llm', reason: args.reason },
    ),
    args.runId,
    args.storyId,
  );
}
