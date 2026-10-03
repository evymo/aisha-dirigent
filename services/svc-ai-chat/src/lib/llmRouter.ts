/**
 * LLM Router — Unified multi-provider abstraction for AI model calls.
 *
 * Delegates to the BackendRegistry and InferenceBackend implementations
 * in `./providers/`.  All backends — cloud (OpenAI, Anthropic, Google)
 * and local (Ollama, Docker, vLLM, MLX) — are identical, swappable
 * resources.  The only difference is availability and configuration.
 *
 * Provider resolution (backward-compat convention hints):
 *   - `gemini-*`  → Google AI (Gemini)
 *   - `claude-*`  → Anthropic
 *   - `docker-*`  → Docker Model Runner (OpenAI-compatible)
 *   - `ollama-*`  → Ollama (OpenAI-compatible, Metal GPU)
 *   - `local-*` / `vllm-*` → vLLM / MLX (OpenAI-compatible)
 *   - `maestro-*` → Maestro dialog management (Alquist Insight)
 *   - everything else → OpenAI
 *
 * Usage:
 *   import { resolveProvider, unifiedChat, type LlmProvider } from "../_shared/llmRouter.ts";
 *
 *   const provider = resolveProvider("gemini-2.0-flash");  // "google"
 *   const result = await unifiedChat({
 *     provider,
 *     model: "gemini-2.0-flash",
 *     systemPrompt: "You are a helpful assistant.",
 *     messages: [{ role: "user", content: "Hello" }],
 *     temperature: 0.4,
 *     maxTokens: 2000,
 *   });
 *   // result.text, result.usage.inputTokens, result.usage.outputTokens, result.provider
 *
 * @module
 */

import { createSafeLogger } from "@aisha/security";
import { getRegistry } from "@aisha/llm-dispatch";
import { isNonChatModelId } from "./modelDiscovery.js";
import { BACKEND_ID_TO_SLUG, PROVIDER_TO_BACKEND_ID, providerForResolvedBackend } from "./providerIdentity.js";
import { rpcService } from "../postgrest.js";
import type { ChatRequest, ChatResponse, InferenceBackend } from "@aisha/llm-dispatch";
import type { UnifiedStreamChunk } from "@aisha/llm-dispatch";

// Re-export isReasoningModel from provider
export { isReasoningModel } from "@aisha/llm-dispatch";
// Identita providera z řádku registru má jeden domov (providerIdentity.ts); re-export drží
// veřejné API modulu (benchmarkRunner, modelSelfTest, testy importují odsud).
export { providerForRegistryRow, providerForResolvedBackend } from "./providerIdentity.js";

const log = createSafeLogger("svc-ai-chat/llm-router");

// =============================================================================
// Types — Backward-compatible public API
// =============================================================================

/** Supported LLM providers.
 *
 *  - "gateway" — AISHA LLM Gateway (theopenco/llmgateway, OpenAI-compatible).
 *    Reached by explicit `provider: 'gateway'` in UnifiedChatOptions when
 *    `aisha_resolve_clow_backend` returns `backend_kind='llm_gateway'`.
 *    The generator node reads `state.clow_backend.backend_kind` and passes
 *    the resolver's pick faithfully to `unifiedChat`.
 */
export type LlmProvider = "openai" | "google" | "anthropic" | "xai" | "vllm" | "docker" | "ollama" | "maestro" | "gateway";

/** Normalised message format for all providers. */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "developer";
  content: string;
}

/** Tool function spec compatible with OpenAI function calling. */
export interface LlmToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** A tool call returned by the LLM. */
export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A tool result to feed back into the LLM. */
export interface LlmToolResult {
  toolCallId: string;
  content: string;
}

/** Options for a unified chat call. */
export interface UnifiedChatOptions {
  /** Resolved provider (use `resolveProvider()` to derive from model string). */
  provider: LlmProvider;
  /** Model identifier (e.g. "gpt-4o", "gemini-2.0-flash", "claude-3-opus"). */
  model: string;
  /** System prompt / instructions. */
  systemPrompt?: string;
  /** Conversation messages. */
  messages: LlmMessage[];
  /** Sampling temperature (ignored for reasoning models). */
  temperature?: number;
  /** Maximum output tokens. */
  maxTokens?: number;
  /** Reasoning effort for OpenAI o-series models. */
  reasoningEffort?: "low" | "medium" | "high";
  /** Force JSON output mode (where supported). */
  jsonMode?: boolean;
  /** Tool definitions for function calling. */
  tools?: LlmToolSpec[];
  /** Tool choice strategy. Default: "auto" if tools are given. */
  toolChoice?: "auto" | "none" | "required";
  /** Tool results to feed back after a tool_calls response. */
  toolResults?: LlmToolResult[];
  /** OpenAI API key override — falls back to env. */
  openaiApiKey?: string;
  /** Google AI API key override — falls back to env. */
  googleApiKey?: string;
  /** Anthropic API key override — falls back to env. */
  anthropicApiKey?: string;
  /** vLLM base URL override — falls back to VLLM_GENERATION_URL env. */
  vllmBaseUrl?: string;
  /** vLLM API key override — falls back to VLLM_API_KEY env. */
  vllmApiKey?: string;
  /** Docker Model Runner base URL override — falls back to DOCKER_MODEL_RUNNER_URL env. */
  dockerBaseUrl?: string;
  /** Ollama base URL override — falls back to OLLAMA_URL env. */
  ollamaBaseUrl?: string;
  /** Maestro base URL override — falls back to MAESTRO_URL env. */
  maestroBaseUrl?: string;
  /** Maestro API key override — falls back to MAESTRO_API_KEY env. */
  maestroApiKey?: string;

  /**
   * MĚŘENÍ, ne provoz: pošli požadavek VÝHRADNĚ backendu `provider` — bez
   * prefixového odhadu podle id modelu, bez fallbacku na jiný backend, bez
   * re-resolve a bez zápisu zdraví providera.
   *
   * ⛔ NAMĚŘENO 2026-09-13: self-test i benchmark volaly
   * `resolveProvider(model_id)`. Alias lokálního modelu (`default-lens`) nemá
   * prefix žádného providera, takže odhad vrátil `openai` — model objevený na
   * vLLM se „testoval" u OpenAI, dostal 404 a byl odmítnut. A kdyby dispatch
   * selhal jen tak, `executeWithFallback` by přes re-resolve odpověděl JINÝM
   * modelem a verdikt by se připsal tomu, na který se ptal. Měření jednoho
   * modelu také není důkaz o zdraví celého providera (třída vady popsaná
   * v modelSelfTest: openai 13× „down" kvůli text-embedding-*).
   *
   * Běžný provoz dál používá `resolveProvider` + fallback; tenhle přepínač patří
   * jen volajícím, kteří měří KONKRÉTNÍ (provider, model) z registru.
   */
  pinProvider?: boolean;

  // ─── Routing context (autonomous; set by orchestrator, not by user) ──────
  /**
   * Routing context from upstream orchestrator decisions (`route_task`,
   * `agent_catalog`). When present, drives autonomous derivation of
   * server-side persistence policy (`storeAtProvider`) in `toChatRequest`.
   *
   * Callers that have access to agent + route_task results should populate
   * this so the platform's policy is applied consistently without each call
   * site re-implementing it. Callers without this context get the closed-
   * by-default behaviour (no provider persistence).
   */
  routeContext?: {
    /** From `agent_catalog.safety_level` of the agent issuing the call. */
    agentSafetyLevel?: "low" | "standard" | "strict";
    /** From `route_task` p_risk_profile / RoutePlan risk classification. */
    riskProfile?: "low" | "medium" | "high" | "critical";
    /** From `ai_provider_registry.backend_kind` of the resolved provider. */
    backendKind?: "direct_cloud" | "local_ollama" | "local_vllm" | "llm_gateway" | "mcp_server";
  };

  /**
   * Explicit override of provider server-side persistence (e.g. OpenAI
   * Responses API `store`). Normally NOT set — derived autonomously from
   * `routeContext` + `provider` via `deriveStoreAtProvider()`. Set this only
   * for tests or special-case opt-outs from the autonomous policy. The
   * closed-by-default safety holds even when both this and routeContext are
   * undefined (adapter falls back to `false`).
   */
  storeAtProvider?: boolean;
}

/** Normalised response from any provider. */
export interface UnifiedChatResult {
  /** The generated text (empty if the response is purely tool calls). */
  text: string;
  /** Token usage counters. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Tool calls requested by the LLM (present when finish reason is tool_calls). */
  toolCalls?: LlmToolCall[];
  /** Whether the response is a tool-call turn (no text, only tool calls). */
  isToolCall?: boolean;
  /** Which provider was used. */
  provider: LlmProvider;
  /** The model string actually called. */
  model: string;
}

// =============================================================================
// Provider Resolution (backward compat — delegates to registry)
// =============================================================================

/**
 * Resolve a model string to its provider — HEURISTIKA PODLE PREFIXU, jen pro ručně psané id.
 *
 * Convention:
 *   - `gemini-*`  → google
 *   - `claude-*`  → anthropic
 *   - `grok-*`    → xai
 *   - everything else → openai
 *
 * ⛔ Smí se volat JEN nad model id, ke kterému není řádek registru: tělo požadavku
 * (`/generate` body.model), override v konfiguraci uzlu, AISHA_SLOT_MODELS. Id z registru
 * nebo z resolveru prefix nést nemusí (alias lokálního modelu, model za llm_gateway) a
 * odhad pak vrátí `openai`. Pro backend vydaný resolverem je `providerForResolvedBackend`
 * (providerIdentity.ts), pro řádek ai_model_registry `providerForRegistryRow`.
 * Hlídá brána src/tests/gates/provider-z-registru-ne-z-prefixu.gate.test.ts.
 */
export function resolveProvider(modelString: string): LlmProvider {
  const m = modelString.toLowerCase();
  if (m.startsWith("maestro")) return "maestro";
  if (m.startsWith("gemini")) return "google";
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("grok")) return "xai";
  if (m.startsWith("docker-")) return "docker";
  if (m.startsWith("ollama-")) return "ollama";
  if (m.startsWith("vllm-") || m.startsWith("local-")) return "vllm";
  // Explicit gateway-tagged model string ("gateway:claude-sonnet-4" or similar).
  // The canonical path to gateway is via `provider: 'gateway'` in
  // UnifiedChatOptions — populated by generator.ts honoring state.clow_backend.
  // This prefix is only the fallback when an operator hand-writes a model id.
  if (m.startsWith("gateway:") || m.startsWith("llm-gateway:")) return "gateway";
  // Auto-detect Docker Model Runner when URL is set and model looks like docker ai/ path
  if (m.startsWith("ai/") && process.env.DOCKER_MODEL_RUNNER_URL) return "docker";
  // Auto-detect Ollama when OLLAMA_URL is set and model doesn't match other patterns
  if (process.env.OLLAMA_URL && !m.includes("/")) return "ollama";
  // Auto-detect vLLM when VLLM_GENERATION_URL is set and model looks like a HuggingFace path
  if (m.includes("/") && process.env.VLLM_GENERATION_URL) return "vllm";
  return "openai";
}

// =============================================================================
// Capability-availability resolution
// =============================================================================

/**
 * Look up a backend's DISCOVERED model ids — DERIVED, never declared. Defaults to
 * the live backend registry's per-backend discovered model list (A1: cloud backends
 * self-load `/v1/models`; openai-compat backends populate `HealthResult.models`), so
 * the remap target is a model the backend actually serves on THIS instance, not a
 * hardcoded per-provider roster (master-plan A3 deletion of `BACKEND_FALLBACK_MODEL`).
 * Injectable so callers/tests can supply an alternate derived source.
 */
export type DiscoveredModelLookup = (backendId: string) => readonly string[];

const registryDiscoveredModels: DiscoveredModelLookup = (id) => getRegistry().getDiscoveredModels(id);

/**
 * Resolve a (slot-preferred) model to one an ACTUALLY-CONFIGURED backend can
 * serve. If the preferred model's provider is configured — or nothing is — keep
 * it; otherwise remap to a configured backend so a reflection run never fails
 * merely because the default provider has no key. Pure + sync (the registry is an
 * in-memory singleton). In a fully-configured production stack this is a no-op
 * (the preferred provider is present); it only adapts when a key is absent.
 *
 * The remap target's MODEL is DERIVED from each configured backend's discovered
 * models (`discoveredModels`) — capability-availability, never a hardcoded fallback
 * constant. We remap to the first chat-capable discovered (servable) model of the
 * highest-priority configured backend (REMAP_PROVIDER_ORDER: cloud-first, then local
 * — a stable preference over provider IDS only, NOT a roster of permitted MODELS).
 * When a configured backend's provider is known but no concrete CHAT model has been
 * discovered yet (cold process), we keep the preferred model (clear downstream error)
 * rather than inventing one. The authoritative model-for-provider choice is the DB
 * resolver (`aisha_resolve_clow_backend`), reached on the dispatch path; this sync
 * helper only adapts the provider axis from the live key truth.
 */
// Stable cloud-first remap preference over provider IDS (not models): when the
// preferred provider is absent we self-route to the highest-priority CONFIGURED
// provider that has a chat-capable discovered model. This is a deployment-ordering
// preference, never a roster of permitted model names; the MODEL chosen is always
// discovered. Unknown ids sort last (stable, after the known cloud→local chain).
const REMAP_PROVIDER_ORDER = ["openai", "anthropic", "google", "xai", "gateway", "vllm", "ollama", "docker"];
const remapRank = (id: string): number => {
  const i = REMAP_PROVIDER_ORDER.indexOf(id);
  return i === -1 ? REMAP_PROVIDER_ORDER.length : i;
};

/**
 * Can a CONFIGURED backend serve this exact model?
 *
 * The complement of `resolveAvailableModel`'s remap: that helper deliberately
 * substitutes a different model when the preferred one has no backend, which is
 * right for routed traffic (something should answer) and WRONG for a caller that
 * pinned a model on purpose. A conformance probe told "measure gpt-4o-mini" must
 * never silently measure whatever else happened to be configured and then attach
 * that verdict to the model it asked for.
 *
 * So callers who pin a model ask this first and fail loudly on false, instead of
 * inferring a remap happened by string-comparing before and after.
 *
 * Returns true when no backends are registered at all — that is the cold-process
 * case `resolveAvailableModel` already passes through untouched, so the dispatch
 * surfaces a clear backend error rather than this function inventing a policy.
 */
export function isModelServable(
  model: string,
  backends: ReadonlyArray<{ id: string; canServe(model: string): boolean }> = getRegistry().getAllBackends(),
): boolean {
  return backends.length === 0 || backends.some((b) => b.canServe(model));
}

export function resolveAvailableModel(
  preferredModel: string,
  backends: ReadonlyArray<{ id: string; canServe(model: string): boolean }> = getRegistry().getAllBackends(),
  discoveredModels: DiscoveredModelLookup = registryDiscoveredModels,
): { model: string; provider: LlmProvider } {
  if (backends.length === 0 || backends.some((b) => b.canServe(preferredModel))) {
    return { model: preferredModel, provider: resolveProvider(preferredModel) };
  }
  // Try configured backends in cloud-first priority order (stable, not array order).
  const ordered = [...backends].sort((a, b) => remapRank(a.id) - remapRank(b.id));
  for (const b of ordered) {
    // Pick the first CHAT-capable discovered model — a non-chat id (e.g. tts-1 or
    // text-embedding-3-*) first in the list must never become the chat remap target.
    const chatModel = discoveredModels(b.id).find((m) => !isNonChatModelId(m));
    if (chatModel) return { model: chatModel, provider: (b.id as LlmProvider) };
    // Backend has models but none chat-capable → skip to the next configured backend.
  }
  // Configured backends exist but none has a chat-capable discovered model yet (cold
  // process) — keep the preferred model so the backend surfaces a clear error, not a
  // silent mismatch. This is the intended fail-loud, NOT a hardcoded fallback.
  return { model: preferredModel, provider: resolveProvider(preferredModel) };
}

/**
 * The provider slugs THIS process can actually serve — derived from the live
 * backend registry (a backend is registered only when its key/endpoint is
 * configured; createXBackend returns null otherwise). This is the runtime
 * "serviceability" axis the capability resolver intersects
 * (aisha_resolve_clow_backend p_context.serviceable_slugs): a provider the DB has
 * enabled but this process holds no key/endpoint for must NOT be resolved. Not a
 * roster — the array IS the live key/endpoint truth, derived not declared.
 */
export function selectServiceableSlugs(
  backends: ReadonlyArray<{ id: string }> = getRegistry().getAllBackends(),
): string[] {
  return [...new Set(backends.map((b) => BACKEND_ID_TO_SLUG[b.id] ?? b.id))];
}

/**
 * Serviceable provider identifiers in BOTH forms — the registry SLUG (e.g. 'google-genai', what
 * selectServiceableSlugs + ai_provider_registry.slug + the resolver use) AND the backend-id form
 * that ai_model_registry.provider stores (e.g. 'google'). A consumer matching against
 * ai_model_registry.provider (benchmark / self-test) MUST accept either, because the model rows
 * use the id form while the slug form drives the resolver — selectServiceableSlugs() alone would
 * skip every google/gemini model. Derived from live backends — never a hardcoded roster.
 */
export function selectServiceableProviderForms(
  backends: ReadonlyArray<{ id: string }> = getRegistry().getAllBackends(),
): string[] {
  return [...new Set(backends.flatMap((b) => [BACKEND_ID_TO_SLUG[b.id] ?? b.id, b.id]))];
}

/**
 * The backends configured in THIS process — registered only when their key/endpoint
 * is present (createXBackend returns null otherwise). The live "which providers can
 * we actually reach" truth; used by model discovery + serviceability.
 */
export function getAllBackends() {
  return getRegistry().getAllBackends();
}

// =============================================================================
// Provider mapping — PROVIDER_TO_BACKEND_ID / BACKEND_ID_TO_SLUG žijí v providerIdentity.ts
// =============================================================================

// =============================================================================
// Adapter: UnifiedChatOptions → ChatRequest
// =============================================================================

// =============================================================================
// Autonomous server-side-persistence policy
// =============================================================================

/**
 * Provider classification for autonomous policy decisions.
 *
 * Today this is derived from the `LlmProvider` union (static type-system
 * data). When `routeContext.backendKind` is supplied (e.g. read from
 * `ai_provider_registry`), it takes precedence and overrides the static
 * heuristic — closing the gap between the type-system view and the
 * DB-driven view in `ai_provider_registry.backend_kind`.
 */
function providerIsLocal(provider: LlmProvider, backendKind?: string): boolean {
  if (backendKind) return backendKind === "local_ollama" || backendKind === "local_vllm";
  return provider === "vllm" || provider === "docker" || provider === "ollama";
}

/**
 * Autonomously derive whether the provider may persist this request
 * server-side (e.g. OpenAI Responses API `store: true`).
 *
 * Rules (closed-by-default; opens only when ALL conditions met):
 *   1. Provider must be local (private infrastructure — no external leak)
 *   2. Agent safety_level must NOT be 'strict'
 *   3. Risk profile must NOT be 'high' or 'critical'
 *
 * Cloud providers + gateway + maestro always default to `false` here.
 * If a future BAA-signed cloud provider should permit storage, that lives
 * in `ai_provider_registry` as a per-provider property — pass
 * `routeContext.backendKind` from there to drive the decision.
 *
 * Observability: callers SHOULD log the derived value (and inputs) to
 * audit_journal / structured logs so the user sees *why* the system
 * decided as it did. The autonomy principle is: the system decides; the
 * user observes (`audit_journal`), and only intervenes by editing the
 * DATA the system reads from (agent_catalog rows, ai_provider_registry
 * rows, route_task decision-tree rules).
 */
export function deriveStoreAtProvider(
  provider: LlmProvider,
  ctx?: UnifiedChatOptions["routeContext"],
): boolean {
  const safety = ctx?.agentSafetyLevel;
  const risk = ctx?.riskProfile;

  // Hard veto: strict-safety agent or high/critical risk → never store
  if (safety === "strict") return false;
  if (risk === "high" || risk === "critical") return false;

  // Local providers may store (private infrastructure)
  if (providerIsLocal(provider, ctx?.backendKind)) return true;

  // Cloud / gateway / maestro / unknown: closed by default
  return false;
}

/** Convert legacy UnifiedChatOptions to the new ChatRequest format. */
function toChatRequest(opts: UnifiedChatOptions): ChatRequest {
  return {
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    messages: opts.messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    reasoningEffort: opts.reasoningEffort,
    jsonMode: opts.jsonMode,
    tools: opts.tools,
    toolChoice: opts.toolChoice,
    toolResults: opts.toolResults,
    // Autonomous: explicit override wins; otherwise derive from routeContext.
    // No caller ever has to think about this — the platform decides from
    // the data it has, and the adapter is a dumb pass-through.
    storeAtProvider:
      opts.storeAtProvider ??
      deriveStoreAtProvider(opts.provider, opts.routeContext),
  };
}

/** Convert new ChatResponse to legacy UnifiedChatResult. */
function toUnifiedResult(resp: ChatResponse, provider: LlmProvider): UnifiedChatResult {
  return {
    text: resp.text,
    usage: resp.usage,
    toolCalls: resp.toolCalls,
    isToolCall: resp.isToolCall,
    provider,
    model: resp.model,
  };
}

// =============================================================================
// Unified Entry Point (with fallback chain)
// =============================================================================

/** Maximum number of fallback attempts (primary + retries). */
const MAX_FALLBACK_ATTEMPTS = 3;

/**
 * Send a chat request to the resolved provider.
 *
 * Routes to the appropriate backend via the BackendRegistry.
 * Supports automatic fallback: if the primary backend fails,
 * tries the next available backend up to MAX_FALLBACK_ATTEMPTS.
 *
 * Returns a normalised `UnifiedChatResult` with text, usage, and provider info.
 *
 * @throws Error if no backend is available or all fallback attempts fail.
 */
export async function unifiedChat(opts: UnifiedChatOptions): Promise<UnifiedChatResult> {
  const registry = getRegistry();
  const request = toChatRequest(opts);

  // Měření konkrétního (provider, model) — viz `pinProvider`. Žádný odhad z id,
  // žádný fallback, žádný zápis zdraví ani jistič: jediný výsledek je odpověď
  // TOHO backendu, nebo jeho vlastní chyba.
  if (opts.pinProvider) {
    const targetId = PROVIDER_TO_BACKEND_ID[opts.provider];
    const pinned = registry.getAllBackends().find((b) => b.id === targetId);
    if (!pinned) {
      throw new Error(
        `[llmRouter] pinned provider "${opts.provider}" není v tomhle procesu nakonfigurovaný ` +
        `(model "${opts.model}") — měření se nepřesměrovává jinam.`,
      );
    }
    const response = await pinned.chat(request);
    return toUnifiedResult(response, opts.provider);
  }

  // Explicit gateway dispatch — when AISHA's resolver returns
  // backend_kind='llm_gateway', generator.ts calls unifiedChat with
  // `provider: 'gateway'`. We skip the model→backend resolveBackends path
  // (gateway has modelPrefixes=[] so prefix-match returns nothing) and go
  // directly by backend id. The "gateway" backend uses AISHA_LLM_GATEWAY_KEY
  // for auth (set in createGatewayBackend factory from env).
  if (opts.provider === "gateway") {
    const allBackends = registry.getAllBackends();
    const gateway = allBackends.find((b) => b.id === "gateway");
    if (!gateway) {
      throw new Error(
        `[llmRouter] gateway backend not configured. ` +
        `Ensure AISHA_LLM_GATEWAY_URL and AISHA_LLM_GATEWAY_KEY are set in process.env.`,
      );
    }
    return executeWithFallback([gateway], request, "gateway", registry);
  }

  // Try to resolve backends via registry first
  const backends = await registry.resolveBackends(opts.model);

  if (backends.length === 0) {
    // Fallback: try to find backend by provider ID (backward compat)
    const targetId = PROVIDER_TO_BACKEND_ID[opts.provider];
    const allBackends = registry.getAllBackends();
    const directBackend = allBackends.find((b) => b.id === targetId);
    if (directBackend) {
      return executeWithFallback([directBackend], request, opts.provider, registry);
    }
    throw new Error(
      `[llmRouter] No available backend for model "${opts.model}" (provider: ${opts.provider})`,
    );
  }

  return executeWithFallback(backends, request, opts.provider, registry);
}

// =============================================================================
// Reactive failover feedback (master-plan A3)
// =============================================================================

/**
 * Minimal RPC surface for the reactive failover loop — injected so the router is
 * unit-testable + auth-agnostic (same pattern as `modelDiscovery.DiscoveryRpc`).
 * Defaults to the service-role `rpcService`.
 */
export type RouterRpc = <T = unknown>(fn: string, params: Record<string, unknown>) => Promise<T | null>;

const defaultRouterRpc: RouterRpc = (fn, params) => rpcService(fn, params);
let routerRpc: RouterRpc = defaultRouterRpc;

/** Override the reactive-feedback RPC surface (tests). Pass nothing to reset. */
export function setRouterRpc(rpc?: RouterRpc): void {
  routerRpc = rpc ?? defaultRouterRpc;
}

/**
 * REACTIVE feedback: a dispatch to `provider` just failed at runtime. Persist that
 * to the registry (`record_provider_health_result(slug,'down',…)`) so the autonomous
 * resolver (`aisha_resolve_clow_backend`) EXCLUDES this provider on the NEXT resolve —
 * its candidate filter requires `last_health_status IN ('healthy','unknown')`. This is
 * the persistent twin of the in-memory circuit breaker (`registry.recordFailure`): the
 * breaker protects THIS process for ~60s; this row makes EVERY future resolve (this
 * process or any other) route around the degraded provider until a health probe clears
 * it. Soft + fire-and-forget: a feedback-write failure must NEVER mask the real dispatch
 * error or block the fallback, so it is awaited only for ordering and swallows its own
 * errors (logged, not thrown). NOT a proactive self-test — it records only an OBSERVED
 * failure (master-plan A3: no suitability matrix, no proactive probing here).
 */
async function reportProviderFailure(provider: LlmProvider, detail: string): Promise<void> {
  const slug = BACKEND_ID_TO_SLUG[PROVIDER_TO_BACKEND_ID[provider]] ?? provider;
  try {
    await routerRpc("record_provider_health_result", {
      p_slug: slug,
      p_status: "down",
      p_detail: `dispatch_failure: ${detail}`.slice(0, 500),
    });
  } catch (err) {
    // Reactive feedback is best-effort — the resolver still has the in-process
    // circuit breaker; never let a registry-write hiccup mask the dispatch error.
    log.safeWarn("[llmRouter] reactive health-record failed (resolver still has circuit breaker)", {
      provider,
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * CAPABILITY-AVAILABILITY RE-RESOLVE (master-plan A3 — replaces the deleted
 * `BACKEND_FALLBACK_MODEL` constant). After the pre-resolved backend chain is
 * exhausted, ask the autonomous resolver for a DIFFERENT suitable candidate,
 * passing only the serviceable slugs MINUS the just-failed provider. Because
 * `reportProviderFailure` has already marked the failed provider `down`, the
 * resolver would exclude it anyway; subtracting it from `serviceable_slugs` makes
 * the exclusion immediate + deterministic even before the health row is visible to
 * this transaction. Returns the re-resolved {provider, model} or null when the
 * resolver finds nothing else suitable (→ defer: the caller surfaces the failure
 * for a later retry, never a hardcoded fallback model id).
 */
async function reResolveExcluding(
  failedProvider: LlmProvider,
  purpose: string,
): Promise<{ provider: LlmProvider; model: string } | null> {
  const failedSlug = BACKEND_ID_TO_SLUG[PROVIDER_TO_BACKEND_ID[failedProvider]] ?? failedProvider;
  const serviceable = selectServiceableSlugs().filter((s) => s !== failedSlug);
  // Nothing else is serviceable → no point asking the resolver (it would return
  // empty). Defer rather than fabricate a model.
  if (serviceable.length === 0) return null;
  try {
    const resolution = await routerRpc<{
      resolved?: boolean;
      top?: { provider_slug?: string; backend_kind?: string; model_id?: string } | null;
    }>(
      "aisha_resolve_clow_backend",
      {
        p_clow: { purpose: (purpose || "chat").slice(0, 200), task_kind: "chat" },
        p_context: { serviceable_slugs: serviceable },
      },
    );
    const top = resolution?.top;
    if (!top?.model_id || !top?.provider_slug) return null;
    // Provider z ŘÁDKU, který resolver vydal — ne z prefixu id. ⛔ NAMĚŘENO 2026-09-13:
    // `resolveProvider(top.model_id)` poslal model za llm_gateway (`llmgateway-io`) nebo
    // lokální alias bez prefixu k `openai`. The resolver already excluded the failed
    // provider (down + slug-subtracted), so a returned candidate is a DIFFERENT backend.
    const provider = providerForResolvedBackend(top);
    if (!provider) {
      log.safeWarn("[llmRouter] re-resolve vydal providera, kterého tenhle proces nezná (defer)", {
        failedProvider,
        providerSlug: top.provider_slug,
        backendKind: top.backend_kind ?? null,
      });
      return null;
    }
    return { provider, model: top.model_id };
  } catch (err) {
    log.safeWarn("[llmRouter] capability-availability re-resolve failed (defer)", {
      failedProvider,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Execute chat with fallback chain. */
async function executeWithFallback(
  backends: readonly InferenceBackend[],
  request: ChatRequest,
  provider: LlmProvider,
  registry: import("@aisha/llm-dispatch").BackendRegistry,
): Promise<UnifiedChatResult> {
  const attempts = Math.min(backends.length, MAX_FALLBACK_ATTEMPTS);
  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    const backend = backends[i];
    try {
      const response = await backend.chat(request);
      registry.recordSuccess(backend.id);
      return toUnifiedResult(response, provider);
    } catch (err) {
      registry.recordFailure(backend.id);
      lastError = err instanceof Error ? err : new Error(String(err));
      // Continue to next backend
    }
  }

  // The pre-resolved chain is exhausted. Before surfacing the error, drive the
  // REACTIVE feedback loop (master-plan A3): record the failure to the registry so
  // the autonomous resolver excludes this provider, then RE-RESOLVE for a DIFFERENT
  // suitable candidate (capability-availability) instead of a hardcoded fallback.
  await reportProviderFailure(provider, lastError?.message ?? "all candidates failed");

  const purpose = request.messages.find((m) => m.role === "user")?.content ?? request.systemPrompt ?? "chat";
  const reResolved = await reResolveExcluding(provider, purpose);
  if (reResolved && reResolved.provider !== provider) {
    const altRegistryBackends = registry.getAllBackends();
    // Backend PROVIDERA, kterého vydal resolver, má přednost před shodou prefixu id.
    // ⛔ Obráceně (dřív) rozhodoval canServe: id `gpt-oss-…` obsluhované lokálním vLLM
    // by prefixem `gpt-` padlo zpět na OpenAI — tedy na providera, který právě selhal.
    const alt =
      altRegistryBackends.find((b) => b.id === PROVIDER_TO_BACKEND_ID[reResolved.provider]) ??
      (await registry.resolveBackends(reResolved.model)).find(Boolean);
    if (alt) {
      try {
        const response = await alt.chat({ ...request, model: reResolved.model });
        registry.recordSuccess(alt.id);
        return toUnifiedResult(response, reResolved.provider);
      } catch (err) {
        registry.recordFailure(alt.id);
        await reportProviderFailure(reResolved.provider, err instanceof Error ? err.message : String(err));
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw lastError ?? new Error("[llmRouter] All backends failed");
}

// =============================================================================
// Streaming Entry Point (§7 streaming inversion) — token-by-token SSE source
// =============================================================================

/**
 * Stream a chat request token-by-token (§7). The streaming twin of
 * {@link unifiedChat}: same DYNAMIC capability-availability resolution, but yields
 * incremental {@link UnifiedStreamChunk}s instead of a buffered result.
 *
 * Commit semantics (§7.3): the backend is selected — and health-checked — BEFORE
 * the first token. ALL fallback happens pre-stream; once the first chunk is
 * yielded the commit is FINAL — there is deliberately NO mid-stream provider
 * switch / retry (a stream cannot un-send bytes). A setup failure throws BEFORE
 * any yield, so a failed commit never masquerades as a successful empty stream.
 *
 * @throws Error if no stream-capable healthy backend is available (pre-first-token).
 */
export async function* unifiedChatStream(opts: UnifiedChatOptions): AsyncGenerator<UnifiedStreamChunk> {
  const registry = getRegistry();

  // DYNAMIC capability-availability selection — remap the (slot-preferred) model
  // to one an ACTUALLY-CONFIGURED backend can serve. A static resolveProvider here
  // would throw "No available backend" on selectively-configured instances (the
  // resolveProvider painting-over class we must never reintroduce on the stream path).
  const resolved = resolveAvailableModel(opts.model);
  const provider = opts.provider === "gateway" ? "gateway" : resolved.provider;
  const request = toChatRequest({ ...opts, model: resolved.model, provider });

  // Resolve candidate backends for the (remapped) model — same paths as unifiedChat.
  let candidates: readonly InferenceBackend[] = [];
  if (provider === "gateway") {
    const gw = registry.getAllBackends().find((b) => b.id === "gateway");
    candidates = gw ? [gw] : [];
  } else {
    candidates = await registry.resolveBackends(resolved.model);
    if (candidates.length === 0) {
      const direct = registry.getAllBackends().find((b) => b.id === PROVIDER_TO_BACKEND_ID[provider]);
      candidates = direct ? [direct] : [];
    }
  }
  if (candidates.length === 0) {
    throw new Error(`[llmRouter] No available backend for model "${resolved.model}" (provider: ${provider})`);
  }

  // PRE-first-token commit: pick the first stream-capable backend that passes a
  // health-check. All retry/fallback is confined to THIS loop — before any byte.
  let committed: InferenceBackend | undefined;
  for (const backend of candidates.slice(0, MAX_FALLBACK_ATTEMPTS)) {
    if (typeof backend.chatStream !== "function") continue;
    const health = await backend.healthCheck();
    if (health.available) {
      committed = backend;
      break;
    }
    registry.recordFailure(backend.id);
  }
  if (!committed) {
    throw new Error(`[llmRouter] No stream-capable healthy backend for model "${resolved.model}" (provider: ${provider})`);
  }

  // Commit is final — stream the chunks. The first yield closes the no-switch
  // window; there is intentionally no re-pick of a backend past this point (§7.3).
  let yielded = false;
  try {
    for await (const chunk of committed.chatStream!(request)) {
      yielded = true;
      yield chunk;
    }
    registry.recordSuccess(committed.id);
  } catch (err) {
    // Pre-first-token failures count as a backend failure (could have fallen back);
    // post-first-token failures are surfaced as-is (commit was final).
    if (!yielded) registry.recordFailure(committed.id);
    throw err;
  }
}

