/**
 * OpenAI Responses API Backend
 *
 * Uses the OpenAI Responses API (not Chat Completions) which supports
 * reasoning models (o1/o3/o4/gpt-5) natively with `reasoning.effort`.
 *
 * @module
 */

import { OpenAI } from "../deps.ts";
import type {
  InferenceBackend,
  BackendKind,
  ChatRequest,
  ChatResponse,
  HealthResult,
  ToolCall,
} from "./types.ts";

/** Check if model is an OpenAI reasoning model (o1/o3/o4/gpt-5). */
export function isReasoningModel(model: string): boolean {
  return /^(o1|o3|o4|gpt-5)/i.test(model);
}

/**
 * OpenAI backend using the Responses API.
 *
 * Handles all OpenAI models including reasoning models that require
 * `reasoning.effort` instead of `temperature`.
 */
export class OpenAIBackend implements InferenceBackend {
  readonly id = "openai";
  readonly label = "OpenAI";
  readonly kind: BackendKind = "cloud";
  readonly supportsTools = true;
  readonly defaultTimeoutMs = 60_000;
  priority = 50;

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? Deno.env.get("OPENAI_API_KEY") ?? "";
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: healthCheck
  // ---------------------------------------------------------------------------
  async healthCheck(): Promise<HealthResult> {
    if (!this.apiKey) return { available: false };
    const start = performance.now();
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        signal: AbortSignal.timeout(5_000),
        headers: { "Authorization": `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return { available: false };
      // Don't bother parsing the full model list
      await res.body?.cancel();
      return { available: true, latencyMs: Math.round(performance.now() - start) };
    } catch (err) {
      console.warn("[openai] health check failed:", err instanceof Error ? err.message : String(err));
      return { available: false };
    }
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: canServe
  // ---------------------------------------------------------------------------
  canServe(model: string): boolean {
    const m = model.toLowerCase();
    // OpenAI serves: gpt-*, o1-*, o3-*, o4-*, chatgpt-*, ft:gpt-*, and doesn't
    // match any other provider's prefix pattern.
    if (
      m.startsWith("gpt-") ||
      m.startsWith("o1") ||
      m.startsWith("o3") ||
      m.startsWith("o4") ||
      m.startsWith("chatgpt-") ||
      m.startsWith("ft:gpt-")
    ) {
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: normalizeModel
  // ---------------------------------------------------------------------------
  normalizeModel(model: string): string {
    return model; // OpenAI model names are used as-is
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: chat
  // ---------------------------------------------------------------------------
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.apiKey) throw new Error("[openai] OPENAI_API_KEY not configured");

    const openai = new OpenAI({ apiKey: this.apiKey });

    // Build input for Responses API format
    const input: Array<Record<string, unknown>> = [];

    for (const msg of request.messages) {
      input.push({
        type: "message",
        role: msg.role,
        content: msg.content,
      });
    }

    // Tool results from previous turn → function_call_output items
    if (request.toolResults && request.toolResults.length > 0) {
      for (const tr of request.toolResults) {
        input.push({
          type: "function_call_output",
          call_id: tr.toolCallId,
          output: tr.content,
        });
      }
    }

    // Model-specific params
    const modelParams: Record<string, unknown> = {};
    if (isReasoningModel(request.model)) {
      if (request.reasoningEffort) {
        modelParams.reasoning = { effort: request.reasoningEffort };
      }
    } else {
      modelParams.temperature = request.temperature ?? 0.4;
    }

    // JSON mode
    const textFormat = request.jsonMode
      ? { format: { type: "json_object" as const } }
      : undefined;

    // Build tools array for Responses API
    const toolsDef: Array<Record<string, unknown>> | undefined =
      request.tools && request.tools.length > 0
        ? request.tools.map((t) => ({
            type: "function",
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          }))
        : undefined;

    const toolChoice =
      toolsDef && request.toolChoice ? request.toolChoice : undefined;

    const createParams: Record<string, unknown> = {
      model: request.model,
      instructions: request.systemPrompt || undefined,
      input,
      ...modelParams,
      max_output_tokens: request.maxTokens ?? 4096,
      ...(textFormat ? { text: textFormat } : {}),
      store: false,
    };

    if (toolsDef) {
      createParams.tools = toolsDef;
    }
    if (toolChoice) {
      createParams.tool_choice = toolChoice;
    }

    const response = await openai.responses.create(createParams);

    // Parse output items
    const toolCalls: ToolCall[] = [];
    let textContent = "";

    if (response.output && Array.isArray(response.output)) {
      for (const item of response.output) {
        const outputItem = item as Record<string, unknown>;
        if (outputItem.type === "function_call") {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs =
              typeof outputItem.arguments === "string"
                ? JSON.parse(outputItem.arguments)
                : (outputItem.arguments ?? {});
          } catch (err) {
            console.warn("[openai] function_call arguments not valid JSON, wrapping as { _raw }:", err);
            parsedArgs = { _raw: outputItem.arguments };
          }
          toolCalls.push({
            id: (outputItem.call_id ?? outputItem.id ?? crypto.randomUUID()) as string,
            name: outputItem.name as string,
            arguments: parsedArgs,
          });
        } else if (outputItem.type === "message") {
          const parts = (outputItem.content ?? []) as Array<Record<string, unknown>>;
          for (const p of parts) {
            if (p.type === "output_text" || p.type === "text") {
              textContent += (p.text as string) ?? "";
            }
          }
        }
      }
    }

    // Fallback to output_text
    if (!textContent) {
      textContent = (response as Record<string, unknown>).output_text as string || "";
    }

    const hasToolCalls = toolCalls.length > 0;

    return {
      text: textContent,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
      toolCalls: hasToolCalls ? toolCalls : undefined,
      isToolCall: hasToolCalls,
      backendId: "openai",
      model: request.model,
    };
  }
}

/** Create an OpenAI backend from env */
export function createOpenAIBackend(): OpenAIBackend | null {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  return new OpenAIBackend(key);
}
