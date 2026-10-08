/**
 * Google Gemini Backend
 *
 * Uses the v1beta generateContent REST endpoint directly (no SDK).
 *
 * Ref: https://ai.google.dev/api/rest/v1beta/models/generateContent
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
import { recordLlmCall } from "./metrics.js";
import { chybiKlic, resolveProviderKey } from "../credentialSource.js";

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
/**
 * Google Gemini inference backend.
 */
export class GeminiBackend implements InferenceBackend {
  readonly id = "google";
  readonly label = "Google Gemini";
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
    return resolveProviderKey("GOOGLE_AI_API_KEY", this.fixedKey);
  }

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------
  async healthCheck(): Promise<HealthResult> {
    const key = await this.key();
    if (!key) return { available: false };
    const start = performance.now();
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!res.ok) return { available: false };

      const latencyMs = Math.round(performance.now() - start);
      const data = await res.json();

      // Gemini /v1beta/models returns { models: [{ name: "models/gemini-...", ... }] }.
      // Strip the "models/" prefix so the discovered id matches canServe()/the
      // generateContent URL convention (bare "gemini-2.5-flash").
      const models: string[] = [];
      if (Array.isArray(data?.models)) {
        for (const m of data.models) {
          if (typeof m.name === "string") {
            models.push(m.name.startsWith("models/") ? m.name.slice("models/".length) : m.name);
          }
        }
      }

      // v1beta/models STRÁNKUJE (`nextPageToken`) — úplný výčet je jen poslední stránka.
      const complete = Array.isArray(data?.models) && !data?.nextPageToken;
      return {
        available: true,
        latencyMs,
        models: models.length > 0 ? models : undefined,
        ...(complete ? { modelsComplete: true } : {}),
      };
    } catch (err) {
      log.safeWarn("[gemini] health check failed", { error: err instanceof Error ? err.message : String(err) });
      return { available: false };
    }
  }

  // ---------------------------------------------------------------------------
  // canServe / normalizeModel
  // ---------------------------------------------------------------------------
  canServe(model: string): boolean {
    return model.toLowerCase().startsWith("gemini");
  }

  normalizeModel(model: string): string {
    return model; // Gemini model names used as-is
  }

  // ---------------------------------------------------------------------------
  // chat
  // ---------------------------------------------------------------------------
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const key = await this.key();
    if (!key) throw chybiKlic("gemini", "GOOGLE_AI_API_KEY");

    // Build contents array
    const contents: Array<{
      role: "user" | "model";
      parts: Array<Record<string, unknown>>;
    }> = [];

    // System instruction
    let systemInstruction: { parts: Array<{ text: string }> } | undefined;
    if (request.systemPrompt) {
      systemInstruction = { parts: [{ text: request.systemPrompt }] };
    }

    for (const msg of request.messages) {
      if (msg.role === "system" || msg.role === "developer") {
        if (systemInstruction) {
          systemInstruction.parts.push({ text: msg.content });
        } else {
          systemInstruction = { parts: [{ text: msg.content }] };
        }
        continue;
      }
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }

    // Tool results as functionResponse parts
    if (request.toolResults && request.toolResults.length > 0) {
      const responseParts = request.toolResults.map((tr) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(tr.content);
        } catch {
          parsed = { result: tr.content };
        }
        return {
          functionResponse: {
            name: tr.toolCallId,
            response: parsed,
          },
        };
      });
      contents.push({ role: "model", parts: responseParts });
    }

    // Ensure at least one user message
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "(empty)" }] });
    }

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.4,
    };

    if (request.jsonMode) {
      generationConfig.responseMimeType = "application/json";
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    // Tools
    if (request.tools && request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        },
      ];
      if (request.toolChoice === "none") {
        body.toolConfig = { functionCallingConfig: { mode: "NONE" } };
      } else if (request.toolChoice === "required") {
        body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent?key=${key}`;

    if (!url.startsWith('https://')) throw new Error('SSRF: Gemini URL must use HTTPS');

    // Metrics: one aisha_llm_calls_total{provider,model,status} emission per
    // call. Defaults to 'error', flipped to 'ok' before a successful return.
    let status: "ok" | "error" = "error";
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.defaultTimeoutMs),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `[gemini] API error (${response.status}): ${errorText.substring(0, 500)}`,
        );
      }

      const data = await response.json();

      const candidates = data.candidates ?? [];
      const parts = candidates[0]?.content?.parts ?? [];
      const textParts: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (const part of parts) {
        if (part.text) {
          textParts.push(part.text);
        } else if (part.functionCall) {
          toolCalls.push({
            id: crypto.randomUUID(),
            name: part.functionCall.name,
            arguments: part.functionCall.args ?? {},
          });
        }
      }

      const usageMetadata = data.usageMetadata ?? {};
      const hasToolCalls = toolCalls.length > 0;

      const result: ChatResponse = {
        text: textParts.join(""),
        usage: {
          inputTokens: usageMetadata.promptTokenCount ?? 0,
          outputTokens: usageMetadata.candidatesTokenCount ?? 0,
        },
        toolCalls: hasToolCalls ? toolCalls : undefined,
        isToolCall: hasToolCalls,
        backendId: "google",
        model: request.model,
      };
      status = "ok";
      return result;
    } finally {
      recordLlmCall("google", request.model, status);
    }
  }
}

/** Create a Gemini backend when THIS process has the key in env — klíč se bere při volání (viz createOpenAIBackend). */
export function createGeminiBackend(): GeminiBackend | null {
  if (!process.env.GOOGLE_AI_API_KEY) return null;
  return new GeminiBackend();
}
