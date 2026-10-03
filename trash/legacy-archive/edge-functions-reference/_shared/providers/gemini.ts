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
} from "./types.ts";

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

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? Deno.env.get("GOOGLE_AI_API_KEY") ?? "";
  }

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------
  async healthCheck(): Promise<HealthResult> {
    if (!this.apiKey) return { available: false };
    const start = performance.now();
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!res.ok) return { available: false };
      await res.body?.cancel();
      return { available: true, latencyMs: Math.round(performance.now() - start) };
    } catch (err) {
      console.warn("[gemini] health check failed:", err instanceof Error ? err.message : String(err));
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
    if (!this.apiKey) throw new Error("[gemini] GOOGLE_AI_API_KEY not configured");

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
        } catch (err) {
          console.warn("[gemini] tool result not valid JSON, wrapping as { result }:", err);
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent?key=${this.apiKey}`;

    if (!url.startsWith('https://')) throw new Error('SSRF: Gemini URL must use HTTPS');

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

    return {
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
  }
}

/** Create a Gemini backend from env */
export function createGeminiBackend(): GeminiBackend | null {
  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) return null;
  return new GeminiBackend(key);
}
