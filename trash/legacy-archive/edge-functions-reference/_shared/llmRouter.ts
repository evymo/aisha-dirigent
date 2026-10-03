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

import { getRegistry } from "./backendRegistry.ts";
import type { ChatRequest, ChatResponse, InferenceBackend } from "./providers/types.ts";

// Re-export isReasoningModel from provider
export { isReasoningModel } from "./providers/openai.ts";

// =============================================================================
// Types — Backward-compatible public API
// =============================================================================

/** Supported LLM providers. */
export type LlmProvider = "openai" | "google" | "anthropic" | "vllm" | "docker" | "ollama";

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
 * Resolve a model string to its provider.
 *
 * Convention:
 *   - `gemini-*`  → google
 *   - `claude-*`  → anthropic
 *   - everything else → openai
 */
export function resolveProvider(modelString: string): LlmProvider {
  const m = modelString.toLowerCase();
  if (m.startsWith("gemini")) return "google";
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("docker-")) return "docker";
  if (m.startsWith("ollama-")) return "ollama";
  if (m.startsWith("vllm-") || m.startsWith("local-")) return "vllm";
  // Auto-detect Docker Model Runner when URL is set and model looks like docker ai/ path
  if (m.startsWith("ai/") && Deno.env.get("DOCKER_MODEL_RUNNER_URL")) return "docker";
  // Auto-detect Ollama when OLLAMA_URL is set and model doesn't match other patterns
  if (Deno.env.get("OLLAMA_URL") && !m.includes("/")) return "ollama";
  // Auto-detect vLLM when VLLM_GENERATION_URL is set and model looks like a HuggingFace path
  if (m.includes("/") && Deno.env.get("VLLM_GENERATION_URL")) return "vllm";
  return "openai";
}

// =============================================================================
// Provider mapping — maps LlmProvider to backend ID
// =============================================================================

const PROVIDER_TO_BACKEND_ID: Record<LlmProvider, string> = {
  openai: "openai",
  google: "google",
  anthropic: "anthropic",
  vllm: "vllm",
  docker: "docker",
  ollama: "ollama",
};

// =============================================================================
// Adapter: UnifiedChatOptions → ChatRequest
// =============================================================================

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

/** Execute chat with fallback chain. */
async function executeWithFallback(
  backends: readonly InferenceBackend[],
  request: ChatRequest,
  provider: LlmProvider,
  registry: import("./backendRegistry.ts").BackendRegistry,
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

  throw lastError ?? new Error("[llmRouter] All backends failed");
}

