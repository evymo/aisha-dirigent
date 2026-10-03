/**
 * Streaming primitives shared across all InferenceBackend providers (§7).
 *
 * The streaming "inversion": every backend can expose `chatStream()` — an async
 * generator yielding incremental `UnifiedStreamChunk`s. A backend's buffered
 * `chat()` can be re-expressed as "consume chatStream + accumulate" via
 * `bufferStream()` so the two modes never drift per-provider (§7.2 "JEDNA cesta").
 *
 * The finish-reason enum is pinned to the OpenAI SDK set and MUST NOT be extended
 * (§5.6 / quota-admission ALLOWED_FINISH_REASONS) — a mid-stream quota cut reuses
 * `content_filter`, never a new value.
 *
 * @module
 */
import type { ChatRequest, ChatResponse, ToolCall } from "./types.js";

/** OpenAI-compatible finish reasons — closed set (SDK compatibility, §5.6). */
export const ALLOWED_FINISH_REASONS = ["stop", "length", "tool_calls", "content_filter"] as const;
export type FinishReason = (typeof ALLOWED_FINISH_REASONS)[number];

/** Partial tool-call fragment streamed incrementally; the consumer accumulates. */
export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsFragment?: string;
}

/** One incremental chunk from a streaming backend (normalised across providers). */
export interface UnifiedStreamChunk {
  /** Incremental delta for this chunk. */
  delta: {
    /** Text appended in this chunk (empty on a usage-only / finish-only chunk). */
    content?: string;
    /** Partial tool-call delta (accumulated by the consumer). */
    toolCallDelta?: ToolCallDelta;
  };
  /** Token usage — present only on the terminal chunk (provider include_usage). */
  usage?: { inputTokens: number; outputTokens: number };
  /** Set on the terminal chunk. */
  finishReason?: FinishReason;
}

/** Map a provider finish_reason string to the allowed enum (default 'stop'). */
export function normalizeFinishReason(raw: string | null | undefined): FinishReason {
  switch (raw) {
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}

/**
 * Consume a chatStream generator and accumulate it into a single ChatResponse —
 * the shared "konzumuj a akumuluj" path (§7.2). Lets a streaming-only backend
 * expose chat() for free, and is the parity oracle (stream vs buffered must
 * accumulate to identical text + token totals).
 */
export async function bufferStream(
  gen: AsyncGenerator<UnifiedStreamChunk>,
  meta: { backendId: string; model: string },
): Promise<ChatResponse> {
  let text = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  for await (const chunk of gen) {
    if (chunk.delta.content) text += chunk.delta.content;
    const td = chunk.delta.toolCallDelta;
    if (td) {
      const cur = toolAcc.get(td.index) ?? { id: "", name: "", args: "" };
      if (td.id) cur.id = td.id;
      if (td.name) cur.name = td.name;
      if (td.argumentsFragment) cur.args += td.argumentsFragment;
      toolAcc.set(td.index, cur);
    }
    if (chunk.usage) usage = chunk.usage;
  }
  const toolCalls: ToolCall[] = [...toolAcc.values()].map((t) => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = t.args ? (JSON.parse(t.args) as Record<string, unknown>) : {};
    } catch {
      parsed = { _raw: t.args };
    }
    return { id: t.id || crypto.randomUUID(), name: t.name, arguments: parsed };
  });
  const hasTools = toolCalls.length > 0;
  return {
    text,
    usage,
    toolCalls: hasTools ? toolCalls : undefined,
    isToolCall: hasTools,
    backendId: meta.backendId,
    model: meta.model,
  };
}

/**
 * Parse an OpenAI-compatible SSE response body into UnifiedStreamChunks.
 * Handles `data: {json}` framing + the terminal `data: [DONE]`. Shared by
 * OpenAICompatBackend (Ollama/vLLM/Docker/gateway) and the OpenAI cloud backend
 * (identical chunk schema). Yields only meaningful chunks (content / tool delta
 * / finish / usage).
 */
export async function* parseOpenAISSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<UnifiedStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        let json: {
          choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const choice = json.choices?.[0] ?? {};
        const delta = (choice.delta ?? {}) as {
          content?: string;
          tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
        const chunk: UnifiedStreamChunk = { delta: {} };
        if (typeof delta.content === "string" && delta.content.length > 0) {
          chunk.delta.content = delta.content;
        }
        if (Array.isArray(delta.tool_calls) && delta.tool_calls[0]) {
          const tc = delta.tool_calls[0];
          chunk.delta.toolCallDelta = {
            index: tc.index ?? 0,
            id: tc.id,
            name: tc.function?.name,
            argumentsFragment: tc.function?.arguments,
          };
        }
        if (choice.finish_reason) {
          chunk.finishReason = normalizeFinishReason(choice.finish_reason);
        }
        if (json.usage) {
          chunk.usage = {
            inputTokens: json.usage.prompt_tokens ?? 0,
            outputTokens: json.usage.completion_tokens ?? 0,
          };
        }
        if (chunk.delta.content || chunk.delta.toolCallDelta || chunk.finishReason || chunk.usage) {
          yield chunk;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Re-export for callers that build a ChatRequest then stream it. */
export type { ChatRequest, ChatResponse };
