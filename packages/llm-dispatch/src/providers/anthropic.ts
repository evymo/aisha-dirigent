/**
 * Anthropic Messages API Backend
 *
 * Uses the Anthropic Messages REST API directly.
 *
 * Ref: https://docs.anthropic.com/en/api/messages
 *
 * odysseus parity package (impl/12 §A + §B-1..B-4, impl/14 G1/G3):
 * the request body is built EXCLUSIVELY by {@link prepareAnthropicBody} — one
 * shared builder for the sync `chat()`, the streaming `chatStream()` and every
 * BATCH caller (`BatchRequestItem.request`, reflection generator node). No
 * path may hand-roll an Anthropic body, otherwise sync and batch drift the
 * moment caching/jsonMode/thinking evolve (enforced by the
 * anthropic-body-builder gate + the A-1 one-builder unit test).
 *
 * Capabilities carried by the builder:
 *  - prompt caching (G1): system blocks + tool schemas get
 *    `cache_control: ephemeral` — stable prefix first, breakpoint after it
 *  - jsonMode (B-3): degrades to a JSON-only system directive (the Messages
 *    API has no native json mode) — parity with openai-compat callers
 *  - extended thinking (G3): `reasoningEffort` → `thinking.budget_tokens`
 *    tiers, clamped to max_tokens (temperature is dropped per API contract)
 *  - betas[]: single source of `anthropic-beta` headers per capability
 *    (CAPABILITY_BETAS); batch transport merges them with `message-batches-*`
 *
 * @module
 */

import type {
  InferenceBackend,
  BackendKind,
  ChatRequest,
  ChatResponse,
  HealthResult,
  ToolCall,
} from "./types.js";
import {
  normalizeFinishReason,
  type FinishReason,
  type UnifiedStreamChunk,
} from "./streaming.js";
import { recordLlmCall } from "./metrics.js";

// =============================================================================
// Shared body builder — THE single source of the Anthropic request shape
// =============================================================================

/**
 * Capability → required `anthropic-beta` header values. SINGLE source of
 * truth (impl/12 §A.3): sync puts them in the header, batch merges them with
 * `message-batches-*`. Prompt caching and extended thinking are GA — no beta.
 * Future capabilities (e.g. server-side context management) register here.
 */
export const CAPABILITY_BETAS: Record<string, string[]> = {
  prompt_caching: [],
  extended_thinking: [],
};

/** JSON-mode directive — the Messages API parity fallback (no native json mode). */
const JSON_ONLY_DIRECTIVE =
  "Respond with valid JSON only — no prose, no markdown code fences, no explanation.";

/** reasoningEffort → thinking budget tiers (tokens). Clamped to max_tokens. */
const THINKING_BUDGET_BY_EFFORT: Record<"low" | "medium" | "high", number> = {
  low: 2_048,
  medium: 8_192,
  high: 16_384,
};

/** Anthropic requires budget_tokens >= 1024 and < max_tokens; keep headroom for the answer. */
const THINKING_MIN_BUDGET = 1_024;
const THINKING_ANSWER_HEADROOM = 1_024;

/** Anthropic stop_reason → unified FinishReason. */
function normalizeAnthropicStopReason(raw: string | null | undefined): FinishReason {
  switch (raw) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return normalizeFinishReason(raw);
  }
}

export interface PreparedAnthropicRequest {
  /** POST body for /v1/messages (and the batch `params` payload, verbatim). */
  body: Record<string, unknown>;
  /** Required `anthropic-beta` values for the enabled capabilities. */
  betas: string[];
}

/**
 * Build the Anthropic Messages request body for a unified {@link ChatRequest}.
 *
 * INVARIANT (impl/12 §A.5): every Anthropic request body — sync, stream,
 * batch — is produced by this function. Callers never hand-assemble bodies.
 */
export function prepareAnthropicBody(request: ChatRequest): PreparedAnthropicRequest {
  // Messages — Anthropic uses "user"/"assistant" only; system rides separately.
  const messages: Array<{ role: "user" | "assistant"; content: string | unknown[] }> = [];

  for (const msg of request.messages) {
    if (msg.role === "system" || msg.role === "developer") continue;
    messages.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.content,
    });
  }

  // Tool results as user message with tool_result blocks
  if (request.toolResults && request.toolResults.length > 0) {
    const toolResultBlocks = request.toolResults.map((tr) => ({
      type: "tool_result" as const,
      tool_use_id: tr.toolCallId,
      content: tr.content,
    }));
    messages.push({ role: "user", content: toolResultBlocks });
  }

  // Ensure alternating roles starting with user
  if (messages.length === 0 || messages[0].role !== "user") {
    messages.unshift({ role: "user", content: "(continue)" });
  }

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens ?? 4096,
    messages,
  };

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  // ── System blocks + prompt caching (G1, impl/10 §1) ───────────────────────
  // Stable prefix FIRST with the cache breakpoint on it; variable part after
  // the breakpoint so it never poisons the cache. jsonMode directive is a
  // stable constant — it precedes nothing variable, so it rides last and the
  // breakpoint placement stays correct for the stable-only / single-prompt
  // cases (whole-system caching for repeat-identical callers like judges).
  const systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [];
  if (request.systemPromptStable) {
    systemBlocks.push({ type: "text", text: request.systemPromptStable });
  }
  if (request.systemPrompt) {
    systemBlocks.push({ type: "text", text: request.systemPrompt });
  }
  if (request.jsonMode) {
    systemBlocks.push({ type: "text", text: JSON_ONLY_DIRECTIVE });
  }
  if (systemBlocks.length > 0) {
    // Breakpoint: after the stable prefix when a stable/variable split is
    // declared; otherwise after the last block (whole system cacheable).
    const breakpointIndex = request.systemPromptStable && request.systemPrompt ? 0 : systemBlocks.length - 1;
    systemBlocks[breakpointIndex].cache_control = { type: "ephemeral" };
    body.system = systemBlocks;
  }

  // ── Tools (+ cache_control on the last schema — stable prefix) ────────────
  if (request.tools && request.tools.length > 0) {
    const tools: Array<Record<string, unknown>> = request.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    tools[tools.length - 1].cache_control = { type: "ephemeral" };
    body.tools = tools;
    if (request.toolChoice) {
      body.tool_choice =
        request.toolChoice === "required"
          ? { type: "any" }
          : request.toolChoice === "none"
            ? { type: "none" as const }
            : { type: "auto" };
    }
  }

  // ── Extended thinking (G3) — reasoningEffort → budget tiers ───────────────
  // Governed per purpose by the resolver (reasoning → high, classification →
  // unset). The API requires budget_tokens < max_tokens and no temperature.
  if (request.reasoningEffort) {
    const maxTokens = body.max_tokens as number;
    const budget = Math.min(
      THINKING_BUDGET_BY_EFFORT[request.reasoningEffort],
      maxTokens - THINKING_ANSWER_HEADROOM,
    );
    if (budget >= THINKING_MIN_BUDGET) {
      body.thinking = { type: "enabled", budget_tokens: budget };
      delete body.temperature; // API contract: temperature is incompatible with thinking
    }
  }

  return { body, betas: [] };
}

/**
 * Anthropic Claude inference backend.
 */
export class AnthropicBackend implements InferenceBackend {
  readonly id = "anthropic";
  readonly label = "Anthropic Claude";
  readonly kind: BackendKind = "cloud";
  readonly supportsTools = true;
  readonly defaultTimeoutMs = 60_000;
  priority = 50;

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  }

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------
  async healthCheck(): Promise<HealthResult> {
    if (!this.apiKey) return { available: false };
    const start = performance.now();
    try {
      // Anthropic exposes GET /v1/models — fetch it so discovery receives the
      // ACTUAL current Claude roster for this key (not a hardcoded list).
      const res = await fetch("https://api.anthropic.com/v1/models", {
        signal: AbortSignal.timeout(5_000),
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      // Only 401/403 means auth failure; any other non-OK leaves the key valid
      // but yields no model list.
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel();
        return { available: false };
      }
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        await res.body?.cancel();
        return { available: true, latencyMs };
      }

      const data = await res.json();

      // Anthropic /v1/models returns { data: [{ id: "claude-...", ... }] }
      const models: string[] = [];
      if (Array.isArray(data?.data)) {
        for (const m of data.data) {
          if (typeof m.id === "string") models.push(m.id);
        }
      }

      // /v1/models STRÁNKUJE — úplný výčet je jen stránka s výslovným `has_more: false`.
      // Cokoli jiného je nezměřená dostupnost, ne „zbytek se neobsluhuje".
      const complete = Array.isArray(data?.data) && data?.has_more === false;
      return {
        available: true,
        latencyMs,
        models: models.length > 0 ? models : undefined,
        ...(complete ? { modelsComplete: true } : {}),
      };
    } catch {
      return { available: false };
    }
  }

  // ---------------------------------------------------------------------------
  // canServe / normalizeModel
  // ---------------------------------------------------------------------------
  canServe(model: string): boolean {
    return model.toLowerCase().startsWith("claude");
  }

  normalizeModel(model: string): string {
    return model; // Anthropic model names used as-is
  }

  // ---------------------------------------------------------------------------
  // shared headers (sync + stream)
  // ---------------------------------------------------------------------------
  private headers(betas: string[]): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
    if (betas.length > 0) headers["anthropic-beta"] = betas.join(",");
    return headers;
  }

  // ---------------------------------------------------------------------------
  // chat
  // ---------------------------------------------------------------------------
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.apiKey) throw new Error("[anthropic] ANTHROPIC_API_KEY not configured");

    const { body, betas } = prepareAnthropicBody(request);

    // Metrics: emit aisha_llm_calls_total{provider,model,status} exactly once
    // per call. Defaults to 'error'; flipped to 'ok' just before a successful
    // return, recorded in `finally` so a thrown/rejected fetch is also counted.
    let status: "ok" | "error" = "error";
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        signal: AbortSignal.timeout(this.defaultTimeoutMs),
        method: "POST",
        headers: this.headers(betas),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `[anthropic] API error (${response.status}): ${errorText.substring(0, 500)}`,
        );
      }

      const data = await response.json();

      const textParts: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (const block of data.content ?? []) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input ?? {},
          });
        }
      }

      const hasToolCalls = toolCalls.length > 0;

      const result: ChatResponse = {
        text: textParts.join(""),
        usage: {
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
          // Prompt-cache counters (B-2): cost accrual reads these at the cached
          // rate (registry cached_input_price_per_m) — sync AND batch results.
          ...(typeof data.usage?.cache_read_input_tokens === "number"
            ? { cacheReadTokens: data.usage.cache_read_input_tokens }
            : {}),
          ...(typeof data.usage?.cache_creation_input_tokens === "number"
            ? { cacheCreationTokens: data.usage.cache_creation_input_tokens }
            : {}),
        },
        toolCalls: hasToolCalls ? toolCalls : undefined,
        isToolCall: hasToolCalls && data.stop_reason === "tool_use",
        backendId: "anthropic",
        model: request.model,
      };
      status = "ok";
      return result;
    } finally {
      recordLlmCall("anthropic", request.model, status);
    }
  }

  // ---------------------------------------------------------------------------
  // chatStream (§7 streaming inversion — B-4 native Anthropic SSE)
  // ---------------------------------------------------------------------------
  async *chatStream(request: ChatRequest): AsyncGenerator<UnifiedStreamChunk> {
    if (!this.apiKey) throw new Error("[anthropic] ANTHROPIC_API_KEY not configured");

    const { body, betas } = prepareAnthropicBody(request);

    // Setup failures MUST throw before the first yield (§7.3) — a failed
    // commit never masquerades as a successful empty stream. Metrics are
    // recorded at the setup seam: 'error' on a failed handshake, 'ok' once the
    // SSE stream is established (one emission per stream call).
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        signal: AbortSignal.timeout(this.defaultTimeoutMs),
        method: "POST",
        headers: this.headers(betas),
        body: JSON.stringify({ ...body, stream: true }),
      });
    } catch (err) {
      recordLlmCall("anthropic", request.model, "error");
      throw err;
    }

    if (!response.ok || !response.body) {
      recordLlmCall("anthropic", request.model, "error");
      const errorText = response.body ? await response.text() : "(no body)";
      throw new Error(
        `[anthropic] stream error (${response.status}): ${errorText.substring(0, 500)}`,
      );
    }
    recordLlmCall("anthropic", request.model, "ok");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: FinishReason = "stop";
    // tool_use block index → unified toolCallDelta index (text blocks don't count)
    const toolIndexByBlock = new Map<number, number>();
    let nextToolIndex = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          const lines = rawEvent.split("\n");
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const eventLine = lines.find((l) => l.startsWith("event:"));

          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(dataLine.slice(5).trim());
          } catch (err) {
            // Tolerate keep-alives / partial junk without killing the stream,
            // but leave a trace — a malformed `data:` line from the Messages
            // API is unusual enough to be worth seeing in logs.
            console.warn("[llm-dispatch] anthropic SSE: skipped unparseable data line", err);
            continue;
          }

          // The payload carries `type` inside data; the `event:` line mirrors
          // it. Prefer data.type, fall back to the event name (robustness).
          const type = (evt.type as string | undefined) ?? eventLine?.slice(6).trim();

          if (type === "message_start") {
            const usage = (evt.message as { usage?: { input_tokens?: number } } | undefined)?.usage;
            inputTokens = usage?.input_tokens ?? 0;
          } else if (type === "content_block_start") {
            const block = evt.content_block as { type?: string; id?: string; name?: string } | undefined;
            const blockIndex = Number(evt.index ?? 0);
            if (block?.type === "tool_use") {
              const idx = nextToolIndex++;
              toolIndexByBlock.set(blockIndex, idx);
              yield {
                delta: { toolCallDelta: { index: idx, id: block.id, name: block.name } },
              };
            }
          } else if (type === "content_block_delta") {
            const delta = evt.delta as
              | { type?: string; text?: string; partial_json?: string }
              | undefined;
            const blockIndex = Number(evt.index ?? 0);
            if (delta?.type === "text_delta" && delta.text) {
              yield { delta: { content: delta.text } };
            } else if (delta?.type === "input_json_delta" && delta.partial_json !== undefined) {
              const idx = toolIndexByBlock.get(blockIndex) ?? 0;
              yield {
                delta: { toolCallDelta: { index: idx, argumentsFragment: delta.partial_json } },
              };
            }
            // thinking_delta / signature_delta are internal — not unified output
          } else if (type === "message_delta") {
            const d = evt.delta as { stop_reason?: string } | undefined;
            if (d?.stop_reason) finishReason = normalizeAnthropicStopReason(d.stop_reason);
            const usage = evt.usage as { output_tokens?: number } | undefined;
            if (typeof usage?.output_tokens === "number") outputTokens = usage.output_tokens;
          } else if (type === "message_stop") {
            yield {
              delta: {},
              usage: { inputTokens, outputTokens },
              finishReason,
            };
          } else if (type === "error") {
            const err = evt.error as { message?: string } | undefined;
            throw new Error(`[anthropic] stream event error: ${err?.message ?? "unknown"}`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/** Create an Anthropic backend from env */
export function createAnthropicBackend(): AnthropicBackend | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new AnthropicBackend(key);
}
