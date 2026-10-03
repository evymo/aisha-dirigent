/**
 * Local LLM Client — Edge chat client for simple tasks.
 *
 * Uses OpenAI-compatible `/v1/chat/completions` endpoint (Ollama, Docker Desktop, vLLM).
 * Scoped for: test error recap, regression hints, context filtering, stats aggregation.
 * NOT for evaluation or final verdicts — those always go to the backend.
 *
 * @module
 */

import { resolveTier, type TaskKind } from "./compute-tier";
import { recordApiCall, type TokenUsage } from "./resource-tracker";
import { recordModelUsage } from "./resource-tracker";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

/** A chat message in OpenAI format. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Options for edge chat completion. */
export interface EdgeChatOptions {
  /** Task kind for tier routing. */
  task: TaskKind;
  /** Maximum tokens in response. */
  maxTokens?: number;
  /** Temperature (0-1). Default 0.3 for factual tasks. */
  temperature?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

/** Params for a raw local chat completion against an explicit endpoint+model. */
export interface LocalChatParams {
  /** OpenAI-compatible base endpoint (…/v1), e.g. from resolveEdgeTarget(). */
  endpoint: string;
  /** Model id to run. */
  model: string;
  /** Conversation messages. */
  messages: ChatMessage[];
  /** Maximum tokens in response. */
  maxTokens?: number;
  /** Temperature (0-1). Default 0.3 for factual tasks. */
  temperature?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

/** Result of an edge chat completion. */
export interface EdgeChatResult {
  content: string;
  model: string;
  tier: "edge" | "self-hosted" | "cloud";
  tokens: TokenUsage;
  latencyMs: number;
}

/** OpenAI-compatible chat completion response. */
interface ChatCompletionResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
  };
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

/** Default timeout for edge requests (ms). */
const EDGE_TIMEOUT_MS = 30_000;

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/**
 * Send a chat completion to the edge (local LLM).
 *
 * Resolves the tier first — if edge is not available or not opted in,
 * returns null (caller should fall back to backend).
 */
export async function edgeChat(
  messages: ChatMessage[],
  options: EdgeChatOptions,
): Promise<EdgeChatResult | null> {
  const resolution = resolveTier(options.task);

  // If tier resolved to backend, signal caller to use backend instead
  if (resolution.tier !== "edge") {
    return null;
  }

  if (!resolution.model) {
    return null;
  }

  return localChat({
    endpoint: resolution.endpoint,
    model: resolution.model,
    messages,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    signal: options.signal,
  });
}

/**
 * Raw OpenAI-compatible chat completion against an EXPLICIT local endpoint+model,
 * WITHOUT tier routing. {@link edgeChat} wraps this after resolving the tier; the
 * workbench drainer calls it directly (the server-side resolver already chose the
 * workbench/local runtime, so the task-kind gate must not apply).
 *
 * Returns null on transport/HTTP failure (caller decides how to surface it).
 */
export async function localChat(params: LocalChatParams): Promise<EdgeChatResult | null> {
  const url = `${params.endpoint.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: params.model,
    messages: params.messages,
    max_tokens: params.maxTokens ?? 1024,
    temperature: params.temperature ?? 0.3,
    stream: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDGE_TIMEOUT_MS);

  // Chain external signal if provided
  if (params.signal) {
    params.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const t0 = performance.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const latencyMs = performance.now() - t0;

    if (!response.ok) {
      recordApiCall("mcp", latencyMs, 0, true);
      return null;
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    const responseBytes = JSON.stringify(data).length;

    const tokens: TokenUsage = {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };

    recordApiCall("mcp", latencyMs, responseBytes, false, tokens);

    // Record per-model usage
    recordModelUsage({
      provider: "edge",
      modelId: data.model || params.model,
      tier: "edge",
      promptTokens: tokens.promptTokens,
      completionTokens: tokens.completionTokens,
      totalLatencyMs: latencyMs,
    });

    return {
      content,
      model: data.model || params.model,
      tier: "edge",
      tokens,
      latencyMs,
    };
  } catch {
    const latencyMs = performance.now() - t0;
    recordApiCall("mcp", latencyMs, 0, true);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Format an edge result tag for display in chat responses.
 * Example: [Edge: llama3.2 · ↑1.2k ↓856 tokens · 340ms]
 */
export function formatEdgeTag(result: EdgeChatResult): string {
  const up = formatTokenCount(result.tokens.promptTokens);
  const down = formatTokenCount(result.tokens.completionTokens);
  const ms = Math.round(result.latencyMs);
  return `[Edge: ${result.model} · ↑${up} ↓${down} tokens · ${ms}ms]`;
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
