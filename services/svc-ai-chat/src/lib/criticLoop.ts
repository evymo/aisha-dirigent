/**
 * Critic loop — Step 5 of retrieval optimization plan 2026.
 *
 * Wraps the initial enrichWithAishaContext() call in chat.ts: if the
 * current context_profile has critic_enabled=true, score the retrieved
 * context's faithfulness via LLM-as-judge, and iteratively re-retrieve
 * with strategy variations until threshold met or iteration cap reached.
 *
 * Capability-applied evolution (no new tables / RPCs):
 *   - Reads config via existing fn_get_critic_config(profile_slug).
 *   - Re-retrieves via existing enrichWithAishaContext (parameter variation).
 *   - Scores via existing unifiedChat (svc-ai-chat LLM router).
 *   - Picks judge backend via existing aisha_resolve_clow_backend
 *     (purpose='rag.critic_judge').
 *   - Records each iteration via existing fn_record_critic_iteration_audited
 *     (which also propagates final faithfulness to ai_runs on terminal
 *     decisions — see migration 20260519010000).
 *
 * Strategies implemented in this PR (TS-controllable):
 *   - expand_tags: appends synonym/related-term keywords to query for the
 *     next compose_context call (LLM-generated query expansion).
 *   - switch_profile: changes contextProfile (e.g. chat_default →
 *     evidence_strict) to broaden ruleset + KB depth.
 *
 * Strategies deferred (require compose_context RPC migration to expose):
 *   - broaden_threshold: needs p_similarity_threshold_override on
 *     compose_context. Skipped if present in config — recorded as
 *     'continue' decision with a metadata note explaining the skip.
 *   - add_kb_layer: needs story_routing_config override. Skipped same way.
 */
import { createSafeLogger } from "@aisha/security";
import { rpcService } from "../postgrest.js";
import { unifiedChat, type UnifiedChatOptions, type LlmProvider } from "./llmRouter.js";
import { providerForResolvedBackend } from "./providerIdentity.js";
import { journalDispatch } from "./dispatchJournal.js";
import { type ContextBundle } from "./orchestrationBridge.js";

const log = createSafeLogger("svc-ai-chat/critic-loop");

/**
 * Caller-provided re-retrieval function. Lets chat.ts own the client and
 * keeps criticLoop.ts free of DB-client / adapter dependencies — also
 * means a future migration that swaps the retrieval RPC needs only one
 * call-site edit.
 */
export type ReRetrieveFn = (params: {
  query: string;
  profile: string;
}) => Promise<ContextBundle | null>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type RetrievalStrategy =
  | "initial"
  | "expand_tags"
  | "switch_profile"
  | "broaden_threshold"
  | "add_kb_layer";

export type CriticDecision = "stop_threshold_met" | "stop_iter_cap" | "continue";

interface CriticConfig {
  critic_enabled: boolean;
  critic_threshold: number; // 0..1
  critic_max_iterations: number; // 1..10
  critic_strategies: RetrievalStrategy[];
}

interface ResolvedJudgeBackend {
  provider_slug: string;
  model_id: string;
  backend_kind: "direct_cloud" | "llm_gateway" | "local_ollama" | "local_vllm" | "mcp_server";
  endpoint_url: string | null;
  auth_env_var: string | null;
  health_status: "healthy" | "degraded" | "down" | "unknown";
}

export interface CriticLoopParams {
  /** ai_runs.id (tracer.runId). */
  runId: string;
  /** context_profiles.slug — drives critic_enabled / threshold / strategies. */
  profileSlug: string;
  /** User question text — used by judge prompt + query-expansion strategy. */
  query: string;
  /** Initial bundle from the first compose_context pass. */
  initialBundle: ContextBundle | null;
  /** Profile slug actually used for the initial retrieval (may differ from
   *  profileSlug if upstream code already escalated). */
  initialProfile: string;
  /** Caller-provided re-retrieval — keeps client out of criticLoop. */
  reretrieve: ReRetrieveFn;
  /** Optional structured debug logger (chat.ts passes addDebug). */
  addDebug?: (stage: string, message: string, level?: "info" | "warn" | "error") => void;
}

export interface CriticLoopResult {
  /** The bundle to use for the final LLM call — either initial (when
   * critic is disabled / first iteration meets threshold) or the
   * best-scoring re-retrieved bundle. */
  finalBundle: ContextBundle | null;
  /** Number of iterations performed (0 = critic disabled, never iterated). */
  iterations: number;
  /** Final faithfulness score, null if critic was disabled or scoring failed. */
  finalFaithfulness: number | null;
  /** Final decision recorded. */
  decision: CriticDecision | "disabled" | "skipped_no_judge";
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export async function runCriticLoop(params: CriticLoopParams): Promise<CriticLoopResult> {
  const debug = (stage: string, msg: string, level: "info" | "warn" | "error" = "info") =>
    params.addDebug?.(`critic.${stage}`, msg, level);

  // 1. Load critic config for this profile. Fast-path when disabled (cheap).
  const config = await loadCriticConfig(params.profileSlug);
  if (!config || !config.critic_enabled) {
    debug("disabled", `Critic loop OFF for profile=${params.profileSlug}`);
    return { finalBundle: params.initialBundle, iterations: 0, finalFaithfulness: null, decision: "disabled" };
  }

  // 2. Resolve judge backend (capability-resolver path). If no provider
  //    available → skip critic loop gracefully (don't fail the chat).
  const judge = await resolveJudgeBackend();
  if (!judge) {
    debug("no_judge", "capability-resolver returned no rag.critic_judge backend — skipping critic loop", "warn");
    return { finalBundle: params.initialBundle, iterations: 0, finalFaithfulness: null, decision: "skipped_no_judge" };
  }

  debug(
    "config",
    `enabled=${config.critic_enabled} threshold=${config.critic_threshold} max_iter=${config.critic_max_iterations} strategies=${config.critic_strategies.join(",")} judge=${judge.provider_slug}:${judge.model_id}`,
  );

  // 3. Iterate. Initial iteration scores the bundle we already have.
  let currentBundle = params.initialBundle;
  let currentProfile = params.initialProfile;
  let currentQuery = params.query;
  let bestBundle = currentBundle;
  let bestFaithfulness: number | null = null;
  let lastDecision: CriticDecision = "continue";
  let completedIterations = 0;

  for (let iteration = 1; iteration <= config.critic_max_iterations; iteration++) {
    completedIterations = iteration;
    // Score current bundle
    const score = await scoreFaithfulness(judge, currentQuery, currentBundle);
    if (score === null) {
      debug("score_fail", `iter=${iteration} scoring returned null — stopping`, "warn");
      break;
    }
    if (bestFaithfulness === null || score > bestFaithfulness) {
      bestFaithfulness = score;
      bestBundle = currentBundle;
    }

    const meetsThreshold = score >= config.critic_threshold;
    const isLastIteration = iteration >= config.critic_max_iterations;
    const decision: CriticDecision = meetsThreshold
      ? "stop_threshold_met"
      : isLastIteration
        ? "stop_iter_cap"
        : "continue";
    lastDecision = decision;

    const chunkIds = extractChunkIds(currentBundle);
    await recordIteration({
      runId: params.runId,
      iteration,
      faithfulness: score,
      contextRecall: null, // reserved for future when judge can estimate recall vs ground-truth chunk set
      chunkIds,
      strategy: iteration === 1 ? "initial" : pickStrategy(config.critic_strategies, iteration - 2),
      decision,
      judgeModel: judge.model_id,
      judgeProvider: judge.provider_slug,
      metadata: {
        profile: currentProfile,
        query_chars: currentQuery.length,
        chunk_count: chunkIds.length,
      },
    });

    debug(
      "iter",
      `iter=${iteration} score=${score.toFixed(3)} decision=${decision} chunks=${chunkIds.length}`,
    );

    if (decision !== "continue") break;

    // Pick next strategy (round-robin over critic_strategies array).
    const stratIdx = iteration - 1;
    const strategy = pickStrategy(config.critic_strategies, stratIdx);

    // Apply strategy. Some are TS-controllable (expand_tags, switch_profile);
    // others need compose_context migration support (broaden_threshold,
    // add_kb_layer) — those degrade to no-op + continue.
    const applied = await applyStrategy({
      strategy,
      judge,
      reretrieve: params.reretrieve,
      currentQuery,
      currentProfile,
    });

    if (!applied) {
      debug("strategy_noop", `strategy=${strategy} not applicable — no-op, stopping at current best`, "warn");
      // Replace lastDecision with iter cap since we can't continue.
      lastDecision = "stop_iter_cap";
      break;
    }
    currentQuery = applied.nextQuery;
    currentProfile = applied.nextProfile;
    currentBundle = applied.nextBundle;
  }

  return {
    finalBundle: bestBundle,
    iterations: completedIterations,
    finalFaithfulness: bestFaithfulness,
    decision: lastDecision,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadCriticConfig(profileSlug: string): Promise<CriticConfig | null> {
  try {
    const data = await rpcService<Array<Record<string, unknown>>>("fn_get_critic_config", {
      p_profile_slug: profileSlug,
    });
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as Record<string, unknown>;
    return {
      critic_enabled: Boolean(row.critic_enabled),
      critic_threshold: typeof row.critic_threshold === "number" ? row.critic_threshold : Number(row.critic_threshold ?? 0.85),
      critic_max_iterations:
        typeof row.critic_max_iterations === "number" ? row.critic_max_iterations : Number(row.critic_max_iterations ?? 3),
      critic_strategies: Array.isArray(row.critic_strategies)
        ? (row.critic_strategies as RetrievalStrategy[])
        : (["expand_tags", "broaden_threshold"] as RetrievalStrategy[]),
    };
  } catch (err) {
    log.safeWarn("[critic-loop] fn_get_critic_config failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

interface ClowResolveResponse {
  provider_slug?: string;
  model_id?: string;
  backend_kind?: ResolvedJudgeBackend["backend_kind"];
  endpoint_url?: string | null;
  auth_env_var?: string | null;
  health_status?: ResolvedJudgeBackend["health_status"];
  decision?: ClowResolveResponse;
  selected?: ClowResolveResponse;
}

async function resolveJudgeBackend(): Promise<ResolvedJudgeBackend | null> {
  try {
    const data = await rpcService<ClowResolveResponse>("aisha_resolve_clow_backend", {
      p_clow: {
        purpose: "rag.critic_judge",
        task_kind: "classification",
        expected_tokens: 200,
        deadline_hours: 1,
        max_cost: 0.002,
        allow_batch: false,
        allow_local: true,
      },
      p_context: {},
    });
    if (!data) return null;
    const raw = data;
    const picked = raw.provider_slug && raw.model_id ? raw : raw.decision ?? raw.selected ?? null;
    if (!picked || !picked.provider_slug || !picked.model_id) return null;
    return {
      provider_slug: picked.provider_slug,
      model_id: picked.model_id,
      backend_kind: picked.backend_kind ?? "direct_cloud",
      endpoint_url: picked.endpoint_url ?? null,
      auth_env_var: picked.auth_env_var ?? null,
      health_status: picked.health_status ?? "unknown",
    };
  } catch {
    return null;
  }
}

/**
 * Provider soudce z ŘÁDKU, který vydal resolver (provider_slug + backend_kind).
 *
 * ⛔ NAMĚŘENO 2026-09-13: direct_cloud (a vše ostatní mimo tři lokální/gateway druhy)
 * rozhodoval prefix `backend.model_id` přes resolveProvider — soudce `xai` s id bez
 * `grok-` nebo slug bez backendu v procesu (resolveJudgeBackend volá resolver BEZ
 * serviceable_slugs, takže ho vydat může) odešel k `openai`. Neznámý provider je
 * teď chyba; volající (scoreFaithfulness / expandQueryTerms) ji zachytí a zaloguje,
 * místo aby hodnotil jiným modelem, než který resolver vybral.
 */
function backendToProvider(backend: ResolvedJudgeBackend): LlmProvider {
  const provider = providerForResolvedBackend(backend);
  if (!provider) {
    throw new Error(
      `[critic-loop] soudce ${backend.provider_slug}/${backend.model_id} (backend_kind ${backend.backend_kind}) ` +
        "nemá v tomhle procesu backend — neposílám k odhadnutému providerovi",
    );
  }
  return provider;
}

const JUDGE_SYSTEM = `You are a strict retrieval-quality evaluator. Given a user question and a set of retrieved context chunks (rules, knowledge items, memory), estimate FAITHFULNESS: how completely the chunks support answering the question.

Return ONLY a JSON object: {"faithfulness": <0..1>, "reasoning": "<one sentence>"}. Do not add prose.
- 1.0 = chunks fully answer the question with high confidence
- 0.5 = chunks partially address it; key gaps remain
- 0.0 = chunks unrelated or contradictory
Be conservative — when in doubt, score lower.`;

function formatBundleForJudge(bundle: ContextBundle | null): string {
  if (!bundle || !bundle.layers) return "(no context retrieved)";
  const parts: string[] = [];
  for (const [layerName, layer] of Object.entries(bundle.layers)) {
    if (!layer) continue;
    const layerText = JSON.stringify(layer).slice(0, 1500);
    parts.push(`### Layer: ${layerName}\n${layerText}`);
  }
  return parts.join("\n\n").slice(0, 8000);
}

async function scoreFaithfulness(
  judge: ResolvedJudgeBackend,
  query: string,
  bundle: ContextBundle | null,
): Promise<number | null> {
  try {
    const provider = backendToProvider(judge);
    const apiKey = judge.auth_env_var ? process.env[judge.auth_env_var] : undefined;
    const opts: UnifiedChatOptions = {
      provider,
      model: judge.model_id,
      systemPrompt: JUDGE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `User question:\n${query}\n\nRetrieved context:\n${formatBundleForJudge(bundle)}\n\nScore faithfulness:`,
        },
      ],
      temperature: 0,
      maxTokens: 200,
      jsonMode: true,
    };
    // Provider-specific endpoint + key overrides.
    if (provider === "vllm" && judge.endpoint_url) opts.vllmBaseUrl = judge.endpoint_url;
    if (provider === "vllm" && apiKey) opts.vllmApiKey = apiKey;
    if (provider === "openai" && apiKey) opts.openaiApiKey = apiKey;
    if (provider === "anthropic" && apiKey) opts.anthropicApiKey = apiKey;
    if (provider === "gateway" && apiKey) opts.openaiApiKey = apiKey;

    await journalDispatch({ model: opts.model, provider: opts.provider, reason: "critic.faithfulness" });
    const result = await unifiedChat(opts);
    return parseJudgeScore(result.text);
  } catch (err) {
    log.safeWarn("[critic-loop] scoreFaithfulness failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function parseJudgeScore(raw: string): number | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (typeof parsed.faithfulness === "number" && Number.isFinite(parsed.faithfulness)) {
      return Math.max(0, Math.min(1, parsed.faithfulness));
    }
    if (typeof parsed.faithfulness === "string") {
      const n = Number(parsed.faithfulness);
      if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
    }
    return null;
  } catch {
    return null;
  }
}

function extractChunkIds(bundle: ContextBundle | null): string[] {
  if (!bundle?.layers) return [];
  const ids: string[] = [];
  for (const layer of Object.values(bundle.layers)) {
    if (!layer || typeof layer !== "object") continue;
    const layerObj = layer as Record<string, unknown>;
    const chunks = layerObj.chunks ?? layerObj.items ?? layerObj.rules;
    if (Array.isArray(chunks)) {
      for (const c of chunks) {
        if (c && typeof c === "object") {
          const candidate = (c as Record<string, unknown>).chunk_id ?? (c as Record<string, unknown>).id;
          if (typeof candidate === "string") ids.push(candidate);
        }
      }
    }
  }
  return ids;
}

interface RecordIterParams {
  runId: string;
  iteration: number;
  faithfulness: number | null;
  contextRecall: number | null;
  chunkIds: string[];
  strategy: RetrievalStrategy;
  decision: CriticDecision;
  judgeModel: string;
  judgeProvider: string;
  metadata: Record<string, unknown>;
}

async function recordIteration(p: RecordIterParams): Promise<void> {
  try {
    // Alphabetical param order — service-security gate invariant.
    await rpcService("fn_record_critic_iteration_audited", {
      p_context_recall: p.contextRecall,
      p_decision: p.decision,
      p_faithfulness: p.faithfulness,
      p_iteration: p.iteration,
      p_judge_model: p.judgeModel,
      p_judge_provider_slug: p.judgeProvider,
      p_metadata: p.metadata,
      p_retrieval_strategy: p.strategy,
      p_retrieved_chunk_ids: p.chunkIds,
      p_run_id: p.runId,
    });
  } catch (err) {
    log.safeWarn("[critic-loop] recordIteration failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

function pickStrategy(strategies: RetrievalStrategy[], index: number): RetrievalStrategy {
  if (!strategies.length) return "expand_tags";
  return strategies[index % strategies.length];
}

interface ApplyStrategyParams {
  strategy: RetrievalStrategy;
  judge: ResolvedJudgeBackend;
  reretrieve: ReRetrieveFn;
  currentQuery: string;
  currentProfile: string;
}

interface AppliedStrategy {
  nextQuery: string;
  nextProfile: string;
  nextBundle: ContextBundle | null;
}

async function applyStrategy(p: ApplyStrategyParams): Promise<AppliedStrategy | null> {
  let nextQuery = p.currentQuery;
  let nextProfile = p.currentProfile;
  switch (p.strategy) {
    case "expand_tags":
      nextQuery = await expandQueryTerms(p.judge, p.currentQuery);
      break;
    case "switch_profile":
      nextProfile = pickAlternativeProfile(p.currentProfile);
      break;
    case "broaden_threshold":
    case "add_kb_layer":
      // Not yet TS-controllable — compose_context RPC doesn't expose
      // threshold / kb-layer overrides. Skip gracefully.
      return null;
    case "initial":
      return null;
  }

  // Caller-provided callback owns the client + retrieval RPC.
  const nextBundle = await p.reretrieve({ profile: nextProfile, query: nextQuery });
  return { nextQuery, nextProfile, nextBundle };
}

async function expandQueryTerms(judge: ResolvedJudgeBackend, query: string): Promise<string> {
  // Quick LLM expansion: generate 2-3 related keywords/synonyms and append.
  // Best-effort — on failure, return original query unchanged.
  try {
    const provider = backendToProvider(judge);
    const apiKey = judge.auth_env_var ? process.env[judge.auth_env_var] : undefined;
    const opts: UnifiedChatOptions = {
      provider,
      model: judge.model_id,
      systemPrompt:
        "You expand a user query with 2-3 related keywords / synonyms in the same language. Return ONLY JSON: {\"keywords\": [\"...\", \"...\"]}. No prose.",
      messages: [{ role: "user", content: query }],
      temperature: 0,
      maxTokens: 100,
      jsonMode: true,
    };
    if (provider === "vllm" && judge.endpoint_url) opts.vllmBaseUrl = judge.endpoint_url;
    if (provider === "vllm" && apiKey) opts.vllmApiKey = apiKey;
    if (provider === "openai" && apiKey) opts.openaiApiKey = apiKey;
    if (provider === "anthropic" && apiKey) opts.anthropicApiKey = apiKey;

    await journalDispatch({ model: opts.model, provider: opts.provider, reason: "critic.expand_query" });
    const result = await unifiedChat(opts);
    const cleaned = result.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as { keywords?: string[] };
    if (!parsed.keywords || !Array.isArray(parsed.keywords)) return query;
    const extra = parsed.keywords.filter((k) => typeof k === "string" && k.length > 0).slice(0, 3).join(" ");
    return extra ? `${query} ${extra}` : query;
  } catch {
    return query;
  }
}

function pickAlternativeProfile(current: string): string {
  // Simple ladder: lightweight → default → evidence_strict. If already at
  // evidence_strict, stay (no further escalation available).
  if (current === "chat_lightweight") return "chat_default";
  if (current === "chat_default") return "evidence_strict";
  return current;
}

