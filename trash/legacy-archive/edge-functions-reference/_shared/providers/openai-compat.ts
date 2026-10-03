/**
 * OpenAI-Compatible Backend — Shared implementation for local inference.
 *
 * Ollama, Docker Model Runner, vLLM, and MLX all expose the same
 * OpenAI-compatible `/v1/chat/completions` endpoint.  This single
 * implementation handles all of them — the only differences are the
 * base URL, auth, model name prefix, and timeout strategy.
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

/** Allow HTTPS or trusted local origins only (SSRF protection). */
function assertSafeUrl(url: string): void {
  if (url.startsWith("https://")) return;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".docker.internal")
    ) return;
  } catch { /* invalid URL — fall through to throw */ }
  throw new Error(`SSRF: URL must use HTTPS or target localhost, got ${url.substring(0, 80)}`);
}

// =============================================================================
// Configuration
// =============================================================================

/** Options to create an OpenAI-compatible backend instance. */
export interface OpenAICompatConfig {
  /** Unique backend identifier (e.g. "ollama-local", "docker-runner"). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Base URL including /v1 (e.g. "http://localhost:11434/v1"). */
  baseUrl: string;
  /** Bearer token — empty string means no auth. */
  apiKey?: string;
  /** Cloud or local. */
  kind: BackendKind;
  /** Whether to advertise tool/function calling support. */
  supportsTools: boolean;
  /** Default timeout for chat requests in ms. */
  defaultTimeoutMs?: number;
  /** Fallback ordering priority (lower = tried first). */
  priority?: number;
  /** Model prefixes this backend handles (e.g. ["docker-", "ai/"]). */
  modelPrefixes: string[];
  /** Health check endpoint path (relative to baseUrl, default: /models). */
  healthPath?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/** Parse tool calls from an OpenAI-compatible message object. */
function parseToolCalls(message: Record<string, unknown>): ToolCall[] {
  const calls: ToolCall[] = [];
  const rawCalls = message.tool_calls;
  if (!Array.isArray(rawCalls)) return calls;

  for (const tc of rawCalls) {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs =
        typeof tc.function?.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments ?? {});
    } catch (err) {
      console.warn("[openai-compat] tool call arguments not valid JSON, wrapping as { _raw }:", err);
      parsedArgs = { _raw: tc.function?.arguments };
    }
    calls.push({
      id: tc.id ?? crypto.randomUUID(),
      name: tc.function?.name ?? "",
      arguments: parsedArgs,
    });
  }
  return calls;
}

// =============================================================================
// Backend Implementation
// =============================================================================

/**
 * OpenAI-compatible inference backend.
 *
 * Works identically for Ollama, Docker Model Runner, vLLM, MLX,
 * and any other server exposing the `/v1/chat/completions` endpoint.
 */
export class OpenAICompatBackend implements InferenceBackend {
  readonly id: string;
  readonly label: string;
  readonly kind: BackendKind;
  readonly supportsTools: boolean;
  readonly defaultTimeoutMs: number;
  priority: number;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly modelPrefixes: string[];
  private readonly healthPath: string;
  /** Models discovered from last health check — used for alias resolution. */
  private discoveredModels: string[] = [];

  constructor(config: OpenAICompatConfig) {
    this.id = config.id;
    this.label = config.label;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey ?? "";
    this.kind = config.kind;
    this.supportsTools = config.supportsTools;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? (config.kind === "local" ? 120_000 : 60_000);
    this.priority = config.priority ?? 50;
    this.modelPrefixes = config.modelPrefixes;
    this.healthPath = config.healthPath ?? "/models";
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: healthCheck
  // ---------------------------------------------------------------------------
  async healthCheck(): Promise<HealthResult> {
    const url = `${this.baseUrl}${this.healthPath}`;
    assertSafeUrl(url);
    const start = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
        headers,
      });
      if (!res.ok) return { available: false };

      const latencyMs = Math.round(performance.now() - start);
      const data = await res.json();

      // OpenAI-compat /v1/models returns { data: [{ id: "model-name", ... }] }
      const models: string[] = [];
      if (Array.isArray(data?.data)) {
        for (const m of data.data) {
          if (typeof m.id === "string") models.push(m.id);
        }
      }
      // Ollama /api/tags returns { models: [{ name: "model", ... }] }
      if (Array.isArray(data?.models)) {
        for (const m of data.models) {
          if (typeof m.name === "string") models.push(m.name);
        }
      }

      if (models.length > 0) this.discoveredModels = models;

      return { available: true, latencyMs, models: models.length > 0 ? models : undefined };
    } catch (err) {
      console.warn(`[${this.id}] health check failed:`, err instanceof Error ? err.message : String(err));
      return { available: false };
    }
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: canServe
  // ---------------------------------------------------------------------------
  canServe(model: string): boolean {
    const m = model.toLowerCase();
    return this.modelPrefixes.some((prefix) => m.startsWith(prefix.toLowerCase()));
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: normalizeModel
  // ---------------------------------------------------------------------------
  normalizeModel(model: string): string {
    const m = model.toLowerCase();
    for (const prefix of this.modelPrefixes) {
      if (m.startsWith(prefix.toLowerCase())) {
        return model.slice(prefix.length);
      }
    }
    return model;
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: chat
  // ---------------------------------------------------------------------------
  async chat(request: ChatRequest): Promise<ChatResponse> {
    let modelName = this.normalizeModel(request.model);

    // Auto-resolve short aliases against discovered models from health check.
    // e.g. "mlx" → "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"
    if (this.discoveredModels.length > 0 && !this.discoveredModels.includes(modelName)) {
      const alias = modelName.toLowerCase();
      const match = this.discoveredModels.find((m) => m.toLowerCase().startsWith(alias));
      if (match) {
        console.log(`[${this.id}] Resolved model alias "${modelName}" → "${match}"`);
        modelName = match;
      } else if (this.discoveredModels.length === 1) {
        // Single model server — use the only available model
        console.log(`[${this.id}] Single model fallback: "${modelName}" → "${this.discoveredModels[0]}"`);
        modelName = this.discoveredModels[0];
      }
    }

    // Build messages array
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    for (const msg of request.messages) {
      messages.push({
        role: msg.role === "developer" ? "system" : msg.role,
        content: msg.content,
      });
    }

    // Append tool results as tool messages
    if (request.toolResults && request.toolResults.length > 0) {
      for (const tr of request.toolResults) {
        messages.push({ role: "tool", content: tr.content });
      }
    }

    const body: Record<string, unknown> = {
      model: modelName,
      messages,
      temperature: request.temperature ?? 0.4,
      max_tokens: request.maxTokens ?? 4096,
    };

    if (request.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
      if (request.toolChoice) {
        body.tool_choice = request.toolChoice;
      }
    }

    const url = `${this.baseUrl}/chat/completions`;
    assertSafeUrl(url);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.defaultTimeoutMs),
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[${this.id}] API error (${response.status}): ${errorText.substring(0, 500)}`,
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const toolCalls = parseToolCalls(message);
    const hasToolCalls = toolCalls.length > 0;

    return {
      text: message.content ?? "",
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      toolCalls: hasToolCalls ? toolCalls : undefined,
      isToolCall: hasToolCalls,
      backendId: this.id,
      model: request.model,
    };
  }
}

// =============================================================================
// Factory Functions — Pre-configured instances for known local backends
// =============================================================================

/** Create an Ollama backend from env */
export function createOllamaBackend(): OpenAICompatBackend | null {
  const url = Deno.env.get("OLLAMA_URL");
  if (!url) return null;
  return new OpenAICompatBackend({
    id: "ollama",
    label: "Ollama (Metal GPU)",
    baseUrl: url,
    kind: "local",
    supportsTools: true,
    defaultTimeoutMs: 120_000,
    priority: 20,
    modelPrefixes: ["ollama-"],
  });
}

/** Create a Docker Model Runner backend from env */
export function createDockerBackend(): OpenAICompatBackend | null {
  const url = Deno.env.get("DOCKER_MODEL_RUNNER_URL");
  if (!url) return null;
  return new OpenAICompatBackend({
    id: "docker",
    label: "Docker Model Runner",
    baseUrl: url,
    kind: "local",
    supportsTools: true,
    defaultTimeoutMs: 120_000,
    priority: 25,
    modelPrefixes: ["docker-", "ai/"],
  });
}

/** Create a vLLM backend from env */
export function createVLLMBackend(): OpenAICompatBackend | null {
  const url = Deno.env.get("VLLM_GENERATION_URL");
  if (!url) return null;
  return new OpenAICompatBackend({
    id: "vllm",
    label: "vLLM Server",
    baseUrl: url,
    apiKey: Deno.env.get("VLLM_API_KEY") ?? "vllm",
    kind: "local",
    supportsTools: true,
    defaultTimeoutMs: 60_000,
    priority: 30,
    modelPrefixes: ["vllm-", "local-"],
  });
}
