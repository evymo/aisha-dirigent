/**
 * Anthropic Messages API Backend
 *
 * Uses the Anthropic Messages REST API directly.
 *
 * Ref: https://docs.anthropic.com/en/api/messages
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
} from "./types.ts";

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
    this.apiKey = apiKey ?? Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  }

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------
  async healthCheck(): Promise<HealthResult> {
    if (!this.apiKey) return { available: false };
    const start = performance.now();
    try {
      // Anthropic doesn't have a /models list endpoint — use a minimal
      // messages call with max_tokens=1 to verify credentials.
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        signal: AbortSignal.timeout(5_000),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      // Even a 400 means the API key works (model might not exist)
      // Only 401/403 means auth failure
      const available = res.status !== 401 && res.status !== 403;
      await res.body?.cancel();
      return {
        available,
        latencyMs: Math.round(performance.now() - start),
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
  // chat
  // ---------------------------------------------------------------------------
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.apiKey) throw new Error("[anthropic] ANTHROPIC_API_KEY not configured");

    // Build messages — Anthropic uses "user"/"assistant" only, system is separate
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

    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    // Tools
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      if (request.toolChoice) {
        body.tool_choice =
          request.toolChoice === "required"
            ? { type: "any" }
            : request.toolChoice === "none"
              ? { type: "none" as const }
              : { type: "auto" };
      }
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      signal: AbortSignal.timeout(this.defaultTimeoutMs),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
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

    return {
      text: textParts.join(""),
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      toolCalls: hasToolCalls ? toolCalls : undefined,
      isToolCall: hasToolCalls && data.stop_reason === "tool_use",
      backendId: "anthropic",
      model: request.model,
    };
  }
}

/** Create an Anthropic backend from env */
export function createAnthropicBackend(): AnthropicBackend | null {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  return new AnthropicBackend(key);
}
