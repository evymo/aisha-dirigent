/**
 * Dynamic capability resolution for RAG-layer LLM calls (Step 1.5).
 *
 * AISHA already owns a CLOW-driven backend resolver in Postgres:
 *   aisha_resolve_clow_backend(p_clow jsonb, p_context jsonb)
 *
 * It consults:
 *   - ai_provider_registry (slug, backend_kind, endpoint_url, auth_env_var,
 *     supports_chat/tool_use/vision/batch, is_enabled, last_health_status,
 *     consecutive_failure_count, cost_class)
 *   - ai_model_registry (per-model specs, references provider_registry_id)
 *   - ai_model_benchmarks (overall_score per task_kind)
 *   - provider_health probe results (refreshed by WF_PROVIDER_HEALTH_PROBE)
 *
 * …and returns the best-fitting provider+model for a given purpose.
 *
 * This file is a thin TypeScript adapter that maps RAG-specific "purposes"
 * (rag.contextual_prefix, rag.eval_answer, rag.eval_judge) onto CLOW shapes
 * and exposes the resolver via a typed function with in-memory TTL caching.
 *
 * Why we DON'T hardcode model ids:
 *   The user's directive ("vse je dynamicke, aisha si musi byt schopna sama
 *   vyhodnotit co ma a nema za moznosti") forbids hardcoding qwen3-30b or
 *   gpt-4o-mini as the de-facto model. Health changes minute-to-minute
 *   (vLLM crashes, OpenAI quota hits, MCP servers go down). The resolver
 *   reads the live state and picks whichever is currently healthy.
 *
 * Null-backend contract (the POLICY lives in the caller, not here):
 *   - resolveRagBackend() returns null when no usable backend is healthy (all
 *     providers down, or none serve the requested capability). It never
 *     substitutes a known-bad provider. What null MEANS is the caller's choice
 *     per purpose: the contextual-prefix ingestion path FAILS LOUD (HTTP 503,
 *     items left unembedded + retried; operator opt-out only via
 *     RAG_PREFIX_ENABLED=false) so a chunk is never embedded without its prefix
 *     (Brick4), while eval/backfill callers may skip the affected row.
 *   - The 60-second TTL cache prevents hammering the resolver on every chunk
 *     during a batch (typical ingestion is 10-50 chunks/item, several
 *     items/batch).
 */
import { rpcService } from '../postgrest.js';

/** RAG-layer purposes — extend as Step 2+ add new LLM call sites. */
export type RagPurpose =
  | 'rag.contextual_prefix'      // Step 1: 1–2 sentence chunk context
  | 'rag.eval_answer'            // Step 0: chat completion for golden Q
  | 'rag.eval_judge'             // Step 0: LLM-as-judge for RAGAS metrics
  | 'rag.embedding'              // Step 3: knowledge_embeddings.embedding_v2 backfill
  | 'rag.safety_scan'            // Step 4: ingestion safety / prompt-injection classifier
  | 'rag.critic_judge'           // Step 5: faithfulness estimator for critic loop
  | 'rag.rerank'                 // Step 6: candidate-list rerank scoring
  | 'rag.graph_extract'          // Step 7: entity/relationship extract
  | 'rag.multimodal_page'        // Step 8: page-image embedding (ColQwen3 / ColPali)
  // odysseus wave (impl/08 §3.6): every new LLM call is governed via
  // aisha_resolve_clow_backend with an explicit purpose — never hardcoded.
  | 'chat.history_compaction'    // impl 03: summarize old chat turns into a compact context block
  | 'research.reasoning'         // impl 04: research planning / gap analysis / synthesis steps
  | 'research.extract';          // impl 04: structured fact extraction from fetched sources

/** Resolved backend for a RAG call. */
export interface ResolvedBackend {
  provider_slug: string;
  model_id: string;
  backend_kind: 'direct_cloud' | 'llm_gateway' | 'local_ollama' | 'local_vllm' | 'mcp_server';
  endpoint_url: string | null;
  auth_env_var: string | null;
  cost_class: 'budget' | 'standard' | 'premium' | null;
  /** Where the decision came from: clow resolver, env-fallback, or static default. */
  resolved_via: 'clow_resolver' | 'env_fallback' | 'static_default';
  /** Health snapshot at resolution time (advisory). */
  health_status: 'healthy' | 'degraded' | 'down' | 'unknown';
  /** Overall score the resolver assigned (0–1). NULL when env-fallback used. */
  overall_score: number | null;
}

/** CLOW shape parameters per purpose. */
interface ClowSpec {
  task_kind: 'chat' | 'classification' | 'reasoning' | 'embedding' | 'extraction';
  expected_tokens: number;
  deadline_hours?: number;
  max_cost?: number;
  allow_batch?: boolean;
  allow_local?: boolean;
  needs_tools?: boolean;
  needs_vision?: boolean;
}

const PURPOSE_TO_CLOW: Record<RagPurpose, ClowSpec> = {
  'rag.contextual_prefix': {
    task_kind: 'classification', // small, structured, latency-sensitive
    expected_tokens: 200,
    deadline_hours: 1,
    max_cost: 0.001,
    allow_batch: false,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'rag.eval_answer': {
    task_kind: 'chat',
    expected_tokens: 600,
    deadline_hours: 1,
    max_cost: 0.01,
    allow_batch: false,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'rag.eval_judge': {
    task_kind: 'classification', // structured 0–1 score output
    expected_tokens: 350,
    deadline_hours: 1,
    max_cost: 0.005,
    allow_batch: false,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'rag.critic_judge': {
    task_kind: 'classification',
    expected_tokens: 200,
    deadline_hours: 1,
    max_cost: 0.002,
    allow_batch: false,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'rag.graph_extract': {
    task_kind: 'extraction',
    expected_tokens: 800,
    deadline_hours: 6,
    max_cost: 0.02,
    allow_batch: true,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'rag.embedding': {
    task_kind: 'embedding',
    expected_tokens: 0, // embeddings don't generate tokens
    deadline_hours: 24,
    max_cost: 0.0001,
    allow_batch: true,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'rag.safety_scan': {
    task_kind: 'classification',
    expected_tokens: 150,
    deadline_hours: 1,
    max_cost: 0.0005,
    allow_batch: false,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'rag.rerank': {
    task_kind: 'reasoning',
    expected_tokens: 100,
    deadline_hours: 1,
    max_cost: 0.001,
    allow_batch: false,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'rag.multimodal_page': {
    task_kind: 'embedding',
    expected_tokens: 0,
    deadline_hours: 24,
    max_cost: 0.001,
    allow_batch: true,
    allow_local: true,
    needs_tools: false,
    needs_vision: true,
  },
  'chat.history_compaction': {
    task_kind: 'chat', // summarization — compact, latency matters (in the chat path)
    expected_tokens: 1024, // ai_runtime.compact_summary_max_tokens ceiling
    deadline_hours: 1,
    max_cost: 0.01,
    allow_batch: false,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'research.reasoning': {
    task_kind: 'reasoning', // planning / gap analysis / synthesis
    expected_tokens: 2000,
    deadline_hours: 1,
    max_cost: 0.05,
    allow_batch: false,
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
  'research.extract': {
    task_kind: 'extraction', // structured facts from fetched sources
    expected_tokens: 1200,
    deadline_hours: 6,
    max_cost: 0.02,
    allow_batch: true, // offline-friendly — batchable via aisha_choose_execution_strategy
    allow_local: true,
    needs_tools: false,
    needs_vision: false,
  },
};

interface RawClowResolution {
  provider_slug?: string;
  model_id?: string;
  backend_kind?: ResolvedBackend['backend_kind'];
  endpoint_url?: string | null;
  auth_env_var?: string | null;
  cost_class?: ResolvedBackend['cost_class'];
  health_status?: ResolvedBackend['health_status'];
  overall_score?: number;
  reasoning?: string;
  // The actual aisha_resolve_clow_backend RPC returns its decision under
  // various keys depending on version. We're tolerant.
  // PRODUCTION shape: the RPC returns the chosen backend under `top` and the
  // ranked list under `candidates` (see aisha_resolve_clow_backend.sql) — this is
  // the shape every live call gets. The flat / decision / selected shapes below
  // are older/alt variants kept for tolerance. (Before this, pickFromResolution
  // never read `top`, so EVERY rag.* resolution returned null in prod → 503.)
  top?: RawClowResolution;
  candidates?: RawClowResolution[];
  decision?: RawClowResolution;
  selected?: RawClowResolution;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; result: ResolvedBackend | null }>();

function cacheKey(purpose: RagPurpose, contextHash: string): string {
  return `${purpose}|${contextHash}`;
}

/** Lightweight cache key generator (purpose + budget). */
function makeContextHash(context: ResolutionContext): string {
  return `b=${context.budget_remaining ?? '_'}`;
}

export interface ResolutionContext {
  /** Remaining USD budget for the current session/run. Resolver may downgrade premium → budget when low. */
  budget_remaining?: number;
  /** Story id, if resolution should consider per-story provider preferences. */
  story_id?: string | null;
  /** When true, bypass cache (e.g. after a known provider outage). */
  no_cache?: boolean;
}

function pickFromResolution(raw: RawClowResolution): RawClowResolution {
  // Accept the PRODUCTION { top, candidates } shape first (what every live RPC
  // returns), then the flat / nested decision|selected variants for tolerance.
  if (raw.top?.provider_slug && raw.top.model_id) return raw.top;
  if (raw.candidates?.[0]?.provider_slug && raw.candidates[0].model_id) return raw.candidates[0];
  if (raw.provider_slug && raw.model_id) return raw;
  if (raw.decision?.provider_slug) return raw.decision;
  if (raw.selected?.provider_slug) return raw.selected;
  return raw;
}

/**
 * Resolve which backend AISHA should use for a given RAG purpose right now.
 *
 * Returns null when no usable provider is available (e.g. all down, or none
 * supports the requested capability). Caller is expected to skip the RAG
 * step gracefully — `null` is the documented "no provider" signal, not
 * an error.
 */
export async function resolveRagBackend(
  purpose: RagPurpose,
  context: ResolutionContext = {},
): Promise<ResolvedBackend | null> {
  if (!context.no_cache) {
    const hit = cache.get(cacheKey(purpose, makeContextHash(context)));
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.result;
    }
  }

  const clowSpec = PURPOSE_TO_CLOW[purpose];
  const clow = { purpose, ...clowSpec };
  const ctx = context.budget_remaining != null
    ? { budget_remaining: context.budget_remaining }
    : {};

  let result: ResolvedBackend | null = null;

  try {
    const raw = await rpcService<RawClowResolution>('aisha_resolve_clow_backend', {
      p_clow: clow,
      p_context: ctx,
    });
    const picked = pickFromResolution(raw ?? {});
    if (picked.provider_slug && picked.model_id) {
      result = {
        provider_slug: picked.provider_slug,
        model_id: picked.model_id,
        backend_kind: picked.backend_kind ?? 'direct_cloud',
        endpoint_url: picked.endpoint_url ?? null,
        auth_env_var: picked.auth_env_var ?? null,
        cost_class: picked.cost_class ?? null,
        resolved_via: 'clow_resolver',
        health_status: picked.health_status ?? 'unknown',
        overall_score: typeof picked.overall_score === 'number' ? picked.overall_score : null,
      };
    }
  } catch {
    // RPC failure: caller-side observability picks this up via the cache miss
    // and the returned null. We do not throw — the contract is "return null
    // when AISHA can't tell us what to use right now".
    result = null;
  }

  // Env-fallback path: if the resolver had no answer, check if the caller has
  // a static env hint configured for this purpose. This keeps developer-local
  // runs working without a fully-populated ai_provider_registry. NEVER used
  // in production where the resolver is the source of truth.
  if (result === null) {
    result = envFallback(purpose);
  }

  cache.set(cacheKey(purpose, makeContextHash(context)), { at: Date.now(), result });
  return result;
}

function envFallback(purpose: RagPurpose): ResolvedBackend | null {
  // Per-purpose env hints. These exist ONLY for developer-local + first-boot
  // scenarios before ai_provider_registry is populated. Production setups
  // should rely on the resolver path; these envs should be UNSET in prod.
  const envMap: Record<RagPurpose, { modelEnv: string; defaultModel?: string }> = {
    'rag.contextual_prefix': { modelEnv: 'RAG_PREFIX_MODEL' },
    'rag.eval_answer':       { modelEnv: 'RAG_EVAL_LLM_MODEL' },
    'rag.eval_judge':        { modelEnv: 'RAG_JUDGE_MODEL' },
    'rag.embedding':         { modelEnv: 'RAG_EMBEDDING_MODEL' },
    'rag.safety_scan':       { modelEnv: 'RAG_SAFETY_SCAN_MODEL' },
    'rag.critic_judge':      { modelEnv: 'RAG_CRITIC_MODEL' },
    'rag.rerank':            { modelEnv: 'RAG_RERANK_MODEL' },
    'rag.graph_extract':     { modelEnv: 'RAG_GRAPH_EXTRACT_MODEL' },
    'rag.multimodal_page':   { modelEnv: 'RAG_MULTIMODAL_PAGE_MODEL' },
    'chat.history_compaction': { modelEnv: 'CHAT_COMPACTION_MODEL' },
    'research.reasoning':    { modelEnv: 'RESEARCH_REASONING_MODEL' },
    'research.extract':      { modelEnv: 'RESEARCH_EXTRACT_MODEL' },
  };
  const hint = envMap[purpose];
  const modelId = process.env[hint.modelEnv];
  if (!modelId || modelId.length === 0) return null;

  // Endpoint a jeho klíč jako PÁR ze stejného zdroje. Dřív endpoint soudce
  // (RAG_JUDGE_BASE_URL) dostal VLLM_API_KEY, kdykoli byl nastavený i vLLM —
  // klíč jednoho poskytovatele na endpoint druhého.
  // Lokální vLLM bývá bez klíče: bez VLLM_API_KEY se prohlásí `null` (bez
  // autentizace), ne jméno proměnné, která neexistuje — klient by jinak správně
  // skončil 503.
  const envPair: Pick<ResolvedBackend, 'endpoint_url' | 'auth_env_var' | 'backend_kind'> =
    process.env.RAG_JUDGE_BASE_URL
      ? { endpoint_url: process.env.RAG_JUDGE_BASE_URL, auth_env_var: 'RAG_JUDGE_API_KEY', backend_kind: 'direct_cloud' }
      : process.env.VLLM_GENERATION_URL
        ? { endpoint_url: process.env.VLLM_GENERATION_URL, auth_env_var: process.env.VLLM_API_KEY ? 'VLLM_API_KEY' : null, backend_kind: 'local_vllm' }
        : { endpoint_url: null, auth_env_var: 'OPENAI_API_KEY', backend_kind: 'direct_cloud' };

  return {
    provider_slug: 'env_fallback',
    model_id: modelId,
    backend_kind: envPair.backend_kind,
    endpoint_url: envPair.endpoint_url,
    auth_env_var: envPair.auth_env_var,
    cost_class: null,
    resolved_via: 'env_fallback',
    health_status: 'unknown',
    overall_score: null,
  };
}

/** Invalidate the cache (e.g. after a known outage or admin-triggered refresh). */
export function clearCapabilityCache(): void {
  cache.clear();
}

/** Inspect a cached entry (test/admin diagnostic). */
export function peekCapabilityCache(purpose: RagPurpose, context: ResolutionContext = {}): ResolvedBackend | null | undefined {
  const hit = cache.get(cacheKey(purpose, makeContextHash(context)));
  return hit?.result;
}

/** Audit-friendly summary of a resolved backend for inclusion in metadata. */
export function summarizeForAudit(resolved: ResolvedBackend | null): Record<string, unknown> {
  if (!resolved) {
    return { resolved: false, resolved_via: 'unavailable' };
  }
  return {
    resolved: true,
    resolved_via: resolved.resolved_via,
    resolved_provider_slug: resolved.provider_slug,
    resolved_model_id: resolved.model_id,
    resolved_backend_kind: resolved.backend_kind,
    resolved_health_status: resolved.health_status,
    resolved_overall_score: resolved.overall_score,
  };
}
