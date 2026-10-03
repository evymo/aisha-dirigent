/**
 * Unified Inference Backend Types
 *
 * Defines the common interface for all LLM inference backends.
 * Every provider — cloud (OpenAI, Anthropic, Google) and local
 * (Ollama, Docker Model Runner, vLLM, MLX) — implements this
 * interface, making backends interchangeable resources.
 *
 * @module
 */

// =============================================================================
// Chat Request / Response (normalised across all backends)
// =============================================================================

/** Normalised message format for all providers. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "developer";
  content: string;
}

/** Tool function spec compatible with OpenAI function calling. */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** A tool call returned by the LLM. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A tool result to feed back into the LLM. */
export interface ToolResult {
  toolCallId: string;
  content: string;
}

/** Unified chat request passed to any backend. */
export interface ChatRequest {
  /** Model identifier (e.g. "gpt-4o", "gemini-2.0-flash", "ai/qwen3-coder"). */
  model: string;
  /** System prompt / instructions. */
  systemPrompt?: string;
  /**
   * STABLE system prefix (odysseus impl/10 §1 — prompt caching): content that
   * is byte-identical across calls (pinned rules, personality, channel
   * instructions). Providers with prompt caching place the cache breakpoint
   * AFTER this block, so the variable part (`systemPrompt` — KB context,
   * query-specific material) never poisons the cache. Optional: when absent,
   * the whole systemPrompt is treated as one cacheable block (right for
   * repeat-identical callers like judges/safety scans).
   */
  systemPromptStable?: string;
  /** Conversation messages. */
  messages: ChatMessage[];
  /** Sampling temperature (ignored for reasoning models). */
  temperature?: number;
  /** Maximum output tokens. */
  maxTokens?: number;
  /** Reasoning effort for OpenAI o-series models. */
  reasoningEffort?: "low" | "medium" | "high";
  /** Force JSON output mode (where supported). */
  jsonMode?: boolean;
  /** Tool definitions for function calling. */
  tools?: ToolSpec[];
  /** Tool choice strategy. Default: "auto" if tools are given. */
  toolChoice?: "auto" | "none" | "required";
  /** Tool results from a previous turn. */
  toolResults?: ToolResult[];
  /**
   * Whether the provider may persist this request server-side
   * (e.g. OpenAI Responses API `store: true` for cross-turn state).
   *
   * **Default (and current production behaviour): `false`.** Sensitive
   * data must not be persisted at external providers without an
   * explicit, audited decision.
   *
   * **Who sets this:** the orchestrator (caller of `chat()`), based on
   * already-resolved data — `agent_catalog.safety_level`,
   * `route_task.risk_profile`, `ai_provider_registry.backend_kind`.
   * The adapter is a pass-through; it does NOT decide policy here.
   *
   * **Not yet wired:** at the time of writing, no caller sets this
   * field — adapters fall back to `false` for the same closed-default
   * behaviour as before. The field exists so that orchestrator-level
   * wiring (separate change) can flow already-resolved decisions
   * through to the adapter without each adapter re-implementing the
   * policy itself. See the architecture-audit principles, Principle 4
   * ("The leaky-abstraction trap"), for the architectural reasoning.
   */
  storeAtProvider?: boolean;
}

/** Normalised response from any backend. */
export interface ChatResponse {
  /** The generated text (empty if the response is purely tool calls). */
  text: string;
  /** Token usage counters. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    /**
     * Prompt-cache read tokens (Anthropic `cache_read_input_tokens`) — billed
     * at the cached rate (registry `cached_input_price_per_m`, ~−90 %).
     * Present only when the provider reports it (impl/12 §B-2).
     */
    cacheReadTokens?: number;
    /** Prompt-cache write tokens (Anthropic `cache_creation_input_tokens`). */
    cacheCreationTokens?: number;
  };
  /** Tool calls requested by the LLM. */
  toolCalls?: ToolCall[];
  /** Whether the response is a tool-call turn (no text, only tool calls). */
  isToolCall?: boolean;
  /** Which backend ID served the request. */
  backendId: string;
  /** The model string actually called. */
  model: string;
}

// =============================================================================
// Inference Backend Interface
// =============================================================================

/** Health probe result. */
export interface HealthResult {
  available: boolean;
  /** Latency of the health probe in ms, undefined if probe failed. */
  latencyMs?: number;
  /** List of model IDs served by this backend (if discoverable). */
  models?: string[];
  /**
   * `true` jen tehdy, když `models` je ÚPLNÝ výčet toho, co backend obsluhuje —
   * odpověď přečtená celá, bez další stránky. Teprve pak absence modelu v
   * seznamu ZNAMENÁ „tenhle model se neobsluhuje" a discovery ho smí vést jako
   * nedostupný. Chybějící příznak = nezměřeno (stránkovaný listing, nečitelné
   * tělo, výpadek), nikdy „prázdno". Brána „Tool failure ≠ data".
   */
  modelsComplete?: boolean;
  /** Error message when probe failed (undefined when available=true). */
  error?: string;
}

/** Backend kind — used for timeout strategy and fallback ordering. */
export type BackendKind = "cloud" | "local";

/**
 * A single inference backend — the unit of abstraction.
 *
 * Implementations: OpenAIBackend, AnthropicBackend, GeminiBackend,
 * OpenAICompatBackend (shared for Ollama, Docker, vLLM, MLX).
 */
export interface InferenceBackend {
  /** Unique backend identifier (e.g. "openai", "ollama-local", "docker-runner"). */
  readonly id: string;

  /** Human-readable label. */
  readonly label: string;

  /** Cloud or local — affects timeout strategy and fallback ordering. */
  readonly kind: BackendKind;

  /** Whether this backend supports tool/function calling. */
  readonly supportsTools: boolean;

  /** Default timeout in ms for chat requests. */
  readonly defaultTimeoutMs: number;

  /** Priority for fallback ordering (lower = tried first). */
  priority: number;

  /**
   * Probe endpoint health. Returns availability and optionally
   * a list of model IDs served by this backend.
   *
   * Must complete within 5 seconds. Should NOT throw — returns
   * `{ available: false }` on any error.
   */
  healthCheck(): Promise<HealthResult>;

  /**
   * Změř nativní rozměr vektoru, který embedding model vrací — jedním
   * požadavkem na embeddings endpoint backendu. Volitelné: backend bez
   * embeddings API metodu nemá. Hází při chybě (volající ji vede jako
   * nezměřeno, nikdy jako rozměr).
   */
  embeddingDimension?(model: string): Promise<number>;

  /**
   * Send a chat request. Throws on API errors.
   */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /**
   * Stream a chat request (§7 streaming inversion). Async generator yielding
   * incremental {@link UnifiedStreamChunk}s (delta content / tool-call fragments,
   * with usage + finishReason on the terminal chunk). Optional: backends that
   * cannot stream omit it and callers fall back to buffered {@link chat}.
   * Implementations MUST throw BEFORE the first yield on a setup failure (so a
   * failed commit never masquerades as a successful empty stream, §7.3).
   */
  chatStream?(request: ChatRequest): AsyncGenerator<import("./streaming.js").UnifiedStreamChunk>;

  /**
   * Check if this backend can serve the given model string.
   * Used by the registry for model → backend resolution.
   */
  canServe(model: string): boolean;

  /**
   * Strip provider prefix from model string to get the raw model name
   * expected by the backend API.
   *
   * E.g. "docker-ai/qwen3" → "ai/qwen3", "ollama-llama3" → "llama3"
   */
  normalizeModel(model: string): string;
}

// =============================================================================
// Re-exports for backward compat (old llmRouter types → new names)
// =============================================================================

/** @deprecated Use ChatMessage */
export type LlmMessage = ChatMessage;
/** @deprecated Use ToolSpec */
export type LlmToolSpec = ToolSpec;
/** @deprecated Use ToolCall */
export type LlmToolCall = ToolCall;
/** @deprecated Use ToolResult */
export type LlmToolResult = ToolResult;
