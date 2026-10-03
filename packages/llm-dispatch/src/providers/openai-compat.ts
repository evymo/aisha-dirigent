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
} from "./types.js";
import { parseOpenAISSE, type UnifiedStreamChunk } from "./streaming.js";
import { recordLlmCall } from "./metrics.js";

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');

/**
 * Zóny, které instance VLASTNÍ — z její vlastní derivace topologie.
 *
 * ⛔ NAMĚŘENO 2026-09-13: vLLM backend s adresou, kterou resolver vydává
 * (`VLLM_GENERATION_URL=http://<prefix>-model.<zóna>:8000/v1`), házel
 * „SSRF: URL must use HTTPS or target localhost" DŘÍV, než odešel jediný
 * požadavek — `assertSafeUrl` stojí v `healthCheck()` před `try`. Discovery tak
 * lokální model nikdy neviděl a každý self-test by ho odmítl, ačkoli služba
 * běžela. Vnitřní provoz jde přes WireGuard mesh (TLS se tam neterminuje),
 * takže `http://` na jméno v zóně instance je provozní tvar, ne únik.
 *
 * Čte se při VOLÁNÍ, ne při načtení modulu — hodnota je vlastnost nasazení.
 * NEDOSAZUJE SE ŽÁDNÝ LITERÁL: u allowlistu míří chybějící a dosazená hodnota
 * na opačné strany bezpečnosti (týž důvod jako `MAESTRO_ALLOWED_SUFFIXES`
 * v maestro.ts). Bez proměnné zóna v povolených prostě není → fail-closed.
 * Prázdno se zahazuje PŘED přilepením tečky: `.${""}` je "." a `host.endsWith(".")`
 * by prošlo každému FQDN zapsanému s koncovou tečkou.
 */
export function instanceOwnedZoneSuffixes(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.INTERNAL_TLD, env.MESH_TLD]
    .map((s) => s?.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, ""))
    .filter((s): s is string => Boolean(s))
    .map((s) => `.${s}`);
}

/** Allow HTTPS, trusted local origins, or plain HTTP inside the instance's own zones (SSRF protection). */
export function assertSafeUrl(url: string, env: NodeJS.ProcessEnv = process.env): void {
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
    if (parsed.protocol === "http:" && instanceOwnedZoneSuffixes(env).some((sfx) => host.endsWith(sfx))) return;
  } catch { /* invalid URL — fall through to throw */ }
  throw new Error(`SSRF: URL must use HTTPS, target localhost, or a host in the instance zone (INTERNAL_TLD/MESH_TLD), got ${url.substring(0, 80)}`);
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
    } catch {
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
      // Úplný výčet = přečetli jsme pole, které protokol vrací CELÉ (OpenAI-kompat
      // /v1/models ani Ollama /api/tags nestránkují). Nečitelné tělo úplné není.
      let listingRead = false;
      if (Array.isArray(data?.data)) {
        listingRead = true;
        for (const m of data.data) {
          if (typeof m.id === "string") models.push(m.id);
        }
      }
      // Ollama /api/tags returns { models: [{ name: "model", ... }] }
      if (Array.isArray(data?.models)) {
        listingRead = true;
        for (const m of data.models) {
          if (typeof m.name === "string") models.push(m.name);
        }
      }

      if (models.length > 0) this.discoveredModels = models;

      return {
        available: true,
        latencyMs,
        models: models.length > 0 ? models : undefined,
        ...(listingRead ? { modelsComplete: true } : {}),
      };
    } catch (err) {
      log.safeWarn(`[${this.id}] health check failed`, { error: err instanceof Error ? err.message : String(err) });
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
  // InferenceBackend: embeddingDimension — rozměr se MĚŘÍ, nedeklaruje
  // ---------------------------------------------------------------------------
  /**
   * ⛔ NAMĚŘENO 2026-09-13: registr nesl rozměr embedding modelu jen jako
   * deklaraci ze seedu, ačkoli alias (EMBED_ALIAS) volí instance a pod týmž
   * jménem může běžet model jiného rozměru. Resolver prostoru (v1 = 1024,
   * v2 = 2560) se o rozměr opírá — nesedící vektor pak Postgres odmítne až při
   * zápisu, daleko od rozhodnutí. Jeden krátký požadavek řekne pravdu.
   *
   * Bez aliasového „dohledání" z `prepareRequest`: měří se přesně `model`.
   */
  async embeddingDimension(model: string): Promise<number> {
    const url = `${this.baseUrl}/embeddings`;
    assertSafeUrl(url);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(this.defaultTimeoutMs),
      headers,
      body: JSON.stringify({ model, input: "dimension probe" }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`[${this.id}] embeddings probe ${res.status} for "${model}": ${body.substring(0, 200)}`);
    }
    const data = await res.json();
    const vector = data?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0 || !vector.every((x: unknown) => typeof x === "number")) {
      throw new Error(`[${this.id}] embeddings probe for "${model}" nevrátil číselný vektor`);
    }
    return vector.length;
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

  /**
   * Listing backendu MUSÍ být znám dřív, než `prepareRequest` rozhodne, jestli id
   * s prefixem backendu (`local-…`) je jméno, pod kterým server model obsluhuje,
   * nebo ručně psaná zkratka k odříznutí.
   *
   * ⛔ Revize patche 2026-09-15: rozhodnutí stálo jen na `discoveredModels`, které
   * plní `healthCheck()` TÉHLE instance backendu. Ve studeném procesu (po startu
   * svc-ai-chat, než doběhne discovery) byl listing prázdný a id deklarované
   * instancí se ořízlo na jméno, které server nezná — tatáž vada, jen s oknem.
   * Listing se proto přečte, když chybí A záleží na něm (id nese prefix backendu).
   * Nedostupný server listing nedá; požadavek pak dopadne jako dřív a selže u serveru.
   */
  private async nactiListingProJmeno(model: string): Promise<void> {
    if (this.discoveredModels.length > 0) return;
    if (this.normalizeModel(model) === model) return;
    await this.healthCheck();
  }

  // ---------------------------------------------------------------------------
  // Shared request builder — used by BOTH chat() and chatStream() so the two
  // modes can never diverge (§7.2 "JEDNA cesta, ne dvě paralelní").
  // ---------------------------------------------------------------------------
  private prepareRequest(request: ChatRequest): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
    // ⛔ NAMĚŘENO 2026-09-13: prefix backendu (`local-`, `vllm-`) se odřízl VŽDY.
    // Jenže svc-model obsluhuje model PŘESNĚ pod aliasem, který instance deklaruje
    // (`local-…`), a pod tímtéž id ho discovery zapisuje do registru. Po odříznutí
    // odcházel požadavek na jméno, které server nezná; hledání aliasu níž nic
    // nenašlo (objevená id prefix nesou) a „single model fallback" se neuplatní,
    // protože svc-model obsluhuje chat i embedding lane. Id, které backend SÁM
    // vypsal ve svém listingu, je jeho vlastní jméno a posílá se beze změny;
    // odříznutí prefixu zůstává pro ručně psané zkratky (`local-mlx` → `mlx…`).
    // Listing, podle kterého se to rozhoduje, zajistí `nactiListingProJmeno` (chat/chatStream).
    let modelName = this.discoveredModels.includes(request.model)
      ? request.model
      : this.normalizeModel(request.model);

    // Auto-resolve short aliases against discovered models from health check.
    // e.g. "mlx" → "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"
    if (this.discoveredModels.length > 0 && !this.discoveredModels.includes(modelName)) {
      const alias = modelName.toLowerCase();
      const match = this.discoveredModels.find((m) => m.toLowerCase().startsWith(alias));
      if (match) {
        log.safeInfo(`[${this.id}] Resolved model alias "${modelName}" → "${match}"`);
        modelName = match;
      } else if (this.discoveredModels.length === 1) {
        // Single model server — use the only available model
        log.safeInfo(`[${this.id}] Single model fallback: "${modelName}" → "${this.discoveredModels[0]}"`);
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

    return { url, headers, body };
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: chat (buffered)
  // ---------------------------------------------------------------------------
  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.nactiListingProJmeno(request.model);
    const { url, headers, body } = this.prepareRequest(request);

    // Metrics: emit aisha_llm_calls_total{provider,model,status} once per call.
    // Defaults to 'error', flipped to 'ok' before a successful return, recorded
    // in `finally` so a rejected fetch is counted too.
    let status: "ok" | "error" = "error";
    try {
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

      const result: ChatResponse = {
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
      status = "ok";
      return result;
    } finally {
      recordLlmCall(this.id, request.model, status);
    }
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: chatStream (§7 — SSE streaming)
  // ---------------------------------------------------------------------------
  async *chatStream(request: ChatRequest): AsyncGenerator<UnifiedStreamChunk> {
    await this.nactiListingProJmeno(request.model);
    const { url, headers, body } = this.prepareRequest(request);
    // stream:true + include_usage so the terminal chunk carries token totals.
    body.stream = true;
    body.stream_options = { include_usage: true };

    // Setup error MUST surface BEFORE the first yield (§7.3): a non-OK response
    // or missing body throws here, never masquerades as a successful empty stream.
    // Metrics: one aisha_llm_calls_total emission per stream at the setup seam.
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.defaultTimeoutMs),
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      recordLlmCall(this.id, request.model, "error");
      throw err;
    }
    if (!response.ok) {
      recordLlmCall(this.id, request.model, "error");
      const errorText = await response.text();
      throw new Error(`[${this.id}] API error (${response.status}): ${errorText.substring(0, 500)}`);
    }
    if (!response.body) {
      recordLlmCall(this.id, request.model, "error");
      throw new Error(`[${this.id}] streaming response had no body`);
    }
    recordLlmCall(this.id, request.model, "ok");

    yield* parseOpenAISSE(response.body);
  }
}

// =============================================================================
// Factory Functions — Pre-configured instances for known local backends
// =============================================================================

/** Create an Ollama backend from env */
export function createOllamaBackend(): OpenAICompatBackend | null {
  const url = process.env.OLLAMA_URL;
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
  const url = process.env.DOCKER_MODEL_RUNNER_URL;
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
  const url = process.env.VLLM_GENERATION_URL;
  if (!url) return null;
  return new OpenAICompatBackend({
    id: "vllm",
    label: "vLLM Server",
    baseUrl: url,
    apiKey: process.env.VLLM_API_KEY ?? "vllm",
    kind: "local",
    supportsTools: true,
    defaultTimeoutMs: 60_000,
    priority: 30,
    modelPrefixes: ["vllm-", "local-"],
  });
}

/**
 * Create an xAI (Grok) backend from env.
 *
 * xAI exposes an OpenAI-compatible `/v1/chat/completions` endpoint at
 * api.x.ai/v1, so it reuses the OpenAICompatBackend shape exactly like the
 * other OpenAI-compatible providers. Registered only when XAI_API_KEY is
 * present (mirrors createOpenAIBackend's key-only gate) — a backend a process
 * holds no key for is never registered, so it never appears in
 * selectServiceableSlugs() and the resolver cannot pick it (capability-
 * availability, not a roster).
 *
 * The provider catalog row (ai_provider_registry slug='xai',
 * auth_env_var='XAI_API_KEY', endpoint 'https://api.x.ai/v1', direct_cloud)
 * already exists in seed core/19_ai_provider_catalog.sql; this is the runtime
 * twin so a discovered Grok model becomes dispatchable.
 *
 * Priority 50 — same as OpenAI/default cloud (no latency advantage over the
 * other direct cloud providers).
 */
export function createXAIBackend(): OpenAICompatBackend | null {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;
  return new OpenAICompatBackend({
    id: "xai",
    label: "xAI Grok (direct)",
    baseUrl: process.env.XAI_BASE_URL ?? "https://api.x.ai/v1",
    apiKey: key,
    kind: "cloud",
    supportsTools: true,
    defaultTimeoutMs: 60_000,
    priority: 50,
    modelPrefixes: ["grok-", "grok"],
  });
}

/**
 * Create the AISHA LLM Gateway backend from env.
 *
 * theopenco/llmgateway exposes an OpenAI-compatible /v1/chat/completions
 * endpoint, so it reuses the OpenAICompatBackend shape. The gateway is a
 * legitimate AISHA backend variant — the resolver may select it whenever
 * the candidate score wins (e.g. for non-time-critical tasks where free
 * observability via Langfuse trace export outweighs the extra hop).
 *
 * Auth: service-side bearer = AISHA_LLM_GATEWAY_KEY (auto-generated by
 * scripts/generate-secrets.mjs, propagated to .env.coolify by cold-start).
 * This llm-gateway is an INTERNAL backend driver (container public:false,
 * http://llm-gateway:4000/v1) — NOT a public IDE endpoint. The governed IDE
 * napoj is the ask/Omni model face (ANTHROPIC_BASE_URL=https://ask.<tld>/v1 +
 * PAT); see AISHA_OMNI_GATEWAY.md §0.6. Backend + Omni traces flow into the
 * same Langfuse project.
 *
 * Priority 35 — falls back to direct providers if gateway is degraded
 * (lower than vLLM's 30 because gateway-routed calls have ~10ms extra hop;
 * direct cloud at priority 5-15 wins for latency-critical paths).
 */
export function createGatewayBackend(): OpenAICompatBackend | null {
  const url = process.env.AISHA_LLM_GATEWAY_URL;
  const apiKey = process.env.AISHA_LLM_GATEWAY_KEY;
  if (!url || !apiKey) return null;
  // theopenco/llmgateway exposes /v1 root at the same level as endpoint host
  const baseUrl = url.replace(/\/$/, "");
  return new OpenAICompatBackend({
    id: "gateway",
    label: "AISHA LLM Gateway",
    baseUrl,
    apiKey,
    kind: "cloud",
    supportsTools: true,
    defaultTimeoutMs: 60_000,
    priority: 35,
    // Gateway can serve ANY model (it's a multi-provider router). We don't
    // restrict by model prefix here — resolver is responsible for picking it.
    // The empty prefix list means canServe() returns false for prefix-match
    // resolution; the gateway is reached via explicit provider='gateway'
    // routing from `generator.ts` reading state.clow_backend.
    modelPrefixes: [],
  });
}
