/**
 * OpenAI Responses API Backend
 *
 * Uses the OpenAI Responses API (not Chat Completions) which supports
 * reasoning models (o1/o3/o4/gpt-5) natively with `reasoning.effort`.
 *
 * @module
 */

import OpenAI from "openai";
import type {
  InferenceBackend,
  BackendKind,
  ChatRequest,
  ChatResponse,
  HealthResult,
  ToolCall,
} from "./types.js";
import { recordLlmCall } from "./metrics.js";
import { chybiKlic, resolveProviderKey } from "../credentialSource.js";

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
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

  /** Pevný klíč, když ho volající předal výslovně; jinak se klíč bere při volání (credentialSource). */
  private readonly fixedKey?: string;

  constructor(apiKey?: string) {
    this.fixedKey = apiKey || undefined;
  }

  /** Klíč v okamžiku volání: pevný → zdroj pověření služby (trezor instance) → bez zdroje env. */
  private key(): Promise<string | null> {
    return resolveProviderKey("OPENAI_API_KEY", this.fixedKey);
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: healthCheck
  // ---------------------------------------------------------------------------
  async healthCheck(): Promise<HealthResult> {
    const key = await this.key();
    if (!key) return { available: false };
    const start = performance.now();
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        signal: AbortSignal.timeout(5_000),
        headers: { "Authorization": `Bearer ${key}` },
      });
      if (!res.ok) return { available: false };

      const latencyMs = Math.round(performance.now() - start);
      const data = await res.json();

      // OpenAI /v1/models returns { data: [{ id: "model-name", ... }] }
      const models: string[] = [];
      const listingRead = Array.isArray(data?.data);
      if (listingRead) {
        for (const m of data.data) {
          if (typeof m.id === "string") models.push(m.id);
        }
      }

      // /v1/models u OpenAI nestránkuje — přečtené pole je úplný výčet (viz HealthResult.modelsComplete).
      return {
        available: true,
        latencyMs,
        models: models.length > 0 ? models : undefined,
        ...(listingRead ? { modelsComplete: true } : {}),
      };
    } catch (err) {
      log.safeWarn("[openai] health check failed", { error: err instanceof Error ? err.message : String(err) });
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
    const key = await this.key();
    if (!key) throw chybiKlic("openai", "OPENAI_API_KEY");

    const openai = new OpenAI({ apiKey: key });

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

    // OpenAI's Responses API rejects json_object output unless the literal word
    // "json" appears in the INPUT messages (the system prompt → `instructions`
    // does NOT count). Reflection nodes phrase it as "JSON" or only in the system
    // prompt, so guarantee it here — once, for every jsonMode caller (critic,
    // tot_evaluate, …) — by appending a minimal system message when absent.
    if (textFormat && !input.some((m) => typeof m.content === "string" && /json/i.test(m.content))) {
      input.push({ type: "message", role: "system", content: "Respond with a json object." });
    }

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

    // Pass-through: the orchestrator (caller of `chat()`) decides whether
    // server-side persistence is permitted, from already-resolved
    // agent_catalog.safety_level + route_task.risk_profile +
    // ai_provider_registry.backend_kind. Default `false` preserves the
    // closed-by-default platform stance — no behaviour change when the
    // caller doesn't set the field.
    const createParams: Record<string, unknown> = {
      model: request.model,
      instructions: request.systemPrompt || undefined,
      input,
      ...modelParams,
      max_output_tokens: request.maxTokens ?? 4096,
      ...(textFormat ? { text: textFormat } : {}),
      store: request.storeAtProvider ?? false,
    };

    if (toolsDef) {
      createParams.tools = toolsDef;
    }
    if (toolChoice) {
      createParams.tool_choice = toolChoice;
    }

    // Metrics: one aisha_llm_calls_total{provider,model,status} emission per
    // call. Defaults to 'error', flipped to 'ok' before a successful return.
    let status: "ok" | "error" = "error";
    try {
      const response = await openai.responses.create(createParams);

      // Parse output items
      const toolCalls: ToolCall[] = [];
      let textContent = "";

      if (response.output && Array.isArray(response.output)) {
        for (const item of response.output) {
          const outputItem = item as unknown as Record<string, unknown>;
          if (outputItem.type === "function_call") {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs =
                typeof outputItem.arguments === "string"
                  ? JSON.parse(outputItem.arguments)
                  : (outputItem.arguments ?? {});
            } catch {
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
        textContent = (response as unknown as Record<string, unknown>).output_text as string || "";
      }

      const hasToolCalls = toolCalls.length > 0;

      const result: ChatResponse = {
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
      status = "ok";
      return result;
    } finally {
      recordLlmCall("openai", request.model, status);
    }
  }
}

/**
 * Create an OpenAI backend when THIS process has the key in env (synchronní start
 * registru). Klíč se do backendu NEPŘIPÍNÁ — bere se při volání (credentialSource),
 * takže hodnota z trezoru instance má přednost před env. Backendy s klíčem jen
 * v trezoru doplní BackendRegistry.reconcileCredentialBackends().
 */
export function createOpenAIBackend(): OpenAIBackend | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAIBackend();
}
