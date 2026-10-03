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
}

/** Normalised response from any backend. */
export interface ChatResponse {
  /** The generated text (empty if the response is purely tool calls). */
  text: string;
  /** Token usage counters. */
  usage: {
    inputTokens: number;
    outputTokens: number;
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
   * Send a chat request. Throws on API errors.
   */
  chat(request: ChatRequest): Promise<ChatResponse>;

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
