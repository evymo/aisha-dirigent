/**
 * Chat completion helper for the RAG eval pipeline (LLM-as-judge) and
 * contextual retrieval worker (Step 1 of optimization plan).
 *
 * Two dispatch paths, selected by `provider_slug` (from the resolver's
 * ResolvedBackend — never hardcoded):
 *   - NATIVE-PROTOCOL providers (`google-genai`, `anthropic`) dispatch through
 *     `@aisha/llm-dispatch`'s GeminiBackend/AnthropicBackend, which speak each
 *     provider's real API (Gemini generateContent, Anthropic /v1/messages).
 *     Blindly POSTing ${base_url}/chat/completions to these 404s — that IS
 *     the bug this branch fixes (svc-ai-chat's shared dispatcher already gets
 *     this right; we reuse it here instead of reimplementing).
 *   - Everything else (openai, xai, mistral, deepseek, llm-gateway,
 *     llmgateway-io, openrouter, local vLLM/Ollama) keeps the existing,
 *     proven /v1/chat/completions path below UNCHANGED.
 *
 * Resolution order for the OpenAI-compat completion endpoint:
 *   1. p_base_url argument (explicit override)
 *   2. process.env.RAG_JUDGE_BASE_URL (eval-specific override)
 *   3. process.env.VLLM_GENERATION_URL (shared vLLM endpoint)
 *   4. process.env.OPENAI_API_BASE_URL
 *   Nic z toho = 503 (endpoint se nedosazuje — viz resolveBaseUrl).
 */
import { config } from '../config.js';
import { GeminiBackend, AnthropicBackend, type ChatRequest as DispatchChatRequest } from '@aisha/llm-dispatch';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Provider slugs whose real API is not OpenAI /chat/completions-shaped. */
const NATIVE_PROTOCOL_PROVIDERS = new Set(['google-genai', 'anthropic']);

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  /** 0–2; 0 = deterministic for eval/judge. */
  temperature?: number;
  /** Hard cap on output tokens. */
  max_tokens?: number;
  /** Force JSON-shaped output. Provider may downgrade to text if unsupported. */
  json_mode?: boolean;
  /**
   * ai_provider_registry.slug of the resolved backend (from ResolvedBackend —
   * always resolver-supplied, never hardcoded). Selects native vs OpenAI-compat
   * dispatch; omitted/unrecognized slugs fall through to OpenAI-compat.
   */
  provider_slug?: string;
  /** Override base URL (defaults to env-based resolution). */
  base_url?: string;
  /** Override API key (defaults to env-based resolution). */
  api_key?: string;
  /**
   * `ai_provider_registry.auth_env_var` of the resolved backend — PROHLÁŠENÍ
   * backendu o tom, zda se vůči němu autentizuje, ne odhad z přítomnosti klíče.
   *
   *   `null`      backend žádnou autentizaci nemá (instanční `local_vllm` /
   *               `local_ollama`) → jede se bez hlavičky
   *   `'NÁZEV'`   backend klíč vyžaduje → `api_key`, jinak `process.env[NÁZEV]`;
   *               chybí-li hodnota, padáme nahlas (žádný cizí klíč místo něj)
   *   neuvedeno   jen `api_key` od volajícího, nebo — u endpointu z prostředí —
   *               klíč spárovaný s tímtéž zdrojem; endpoint od volajícího bez
   *               klíče = 503 (viz resolveApiKey)
   *
   * Každé volání ve službě prohlášení předává — hlídá to test
   * „každé volání nese auth_env_var“ v llm-completion.unit.test.ts.
   *
   * Bez tohohle pole se lokální bezklíčový backend NEDAL zavolat: strážce
   * `if (!apiKey) throw 503` platil i pro `auth_env_var: null`, takže se korpus
   * nedal vektorizovat na vlastním stroji — přesně to, čemu se má předejít.
   * `embed-dispatcher.ts` to má správně (hlavička jen když klíč je); tohle
   * srovnává obě dráhy téže služby.
   */
  auth_env_var?: string | null;
  /** AbortSignal for caller-controlled cancellation. */
  signal?: AbortSignal;
  /** Per-request timeout in ms (default 90000). */
  timeout_ms?: number;
}

export interface CompletionResult {
  /** The generated text content. */
  text: string;
  /** Provider-reported token usage. */
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** The model id the provider actually used. */
  model: string;
  /** Provider stop reason (e.g. 'stop', 'length'). */
  finish_reason: string;
  /** End-to-end latency in milliseconds. */
  latency_ms: number;
}

export class LlmCompletionError extends Error {
  constructor(public statusCode: number, message: string, public providerBody?: string) {
    super(message);
    this.name = 'LlmCompletionError';
  }
}

/**
 * Odkud endpoint pochází. Klíč patří k ENDPOINTU, ne k volání: endpoint z
 * `RAG_JUDGE_BASE_URL` smí dostat jen `RAG_JUDGE_API_KEY`, endpoint z
 * `VLLM_GENERATION_URL` jen `VLLM_API_KEY`, a klíč OpenAI jen endpoint OpenAI.
 * Endpoint předaný volajícím (resolver) má klíč určený prohlášením backendu.
 */
type EndpointSource = 'caller' | 'RAG_JUDGE_BASE_URL' | 'VLLM_GENERATION_URL' | 'openai';

/**
 * Endpoint je DEKLAROVANÝ (resolver, nebo jedna z proměnných níž) — nikdy
 * dosazený. Dřív tu končil literál `https://api.openai.com/v1`: kdo nic
 * nedeklaroval, tiše volal OpenAI (a s ním odcházel i klíč). Pravidlo majitele
 * „žádné fallbacky“ (brána zadny-fallback-nad-identitou): chybí-li deklarace,
 * vrací se `null` a volání selže nahlas.
 */
function resolveBaseUrl(override?: string): { url: string; source: EndpointSource } | null {
  const trim = (u: string) => u.replace(/\/+$/, '');
  if (override && override.trim().length > 0) return { url: trim(override), source: 'caller' };
  if (process.env.RAG_JUDGE_BASE_URL) return { url: trim(process.env.RAG_JUDGE_BASE_URL), source: 'RAG_JUDGE_BASE_URL' };
  if (process.env.VLLM_GENERATION_URL) return { url: trim(process.env.VLLM_GENERATION_URL), source: 'VLLM_GENERATION_URL' };
  if (process.env.OPENAI_API_BASE_URL) return { url: trim(process.env.OPENAI_API_BASE_URL), source: 'openai' };
  return null;
}

const nonEmpty = (v: string | undefined | null): string | null => (v && v.trim().length > 0 ? v : null);

/**
 * Klíč pro požadavek — JEN ten, který patří jeho endpointu.
 *
 * ⛔ NAMĚŘENO 2026-09-28: dřívější `resolveApiKey` padal řetězem
 * RAG_JUDGE_API_KEY → VLLM_API_KEY → OPENAI_API_KEY pro KAŽDÝ endpoint. Safety
 * scan (i graph-extract, rag-eval, soudci) nepředával `auth_env_var`, takže
 * cizí pověření odcházelo jako Bearer na endpoint resolveru — i na LOKÁLNÍ
 * model server. A prohlášená proměnná se bez `api_key` vůbec nečetla.
 *
 *   auth_env_var === null     backend autentizaci nemá → žádný klíč
 *   auth_env_var = 'NÁZEV'    klíč = api_key ?? process.env[NÁZEV]; chybí → 503
 *   neuvedeno + api_key       klíč předaný volajícím
 *   neuvedeno, endpoint od volajícího, bez api_key
 *                             → 503: backend svou autentizaci nedeklaroval a
 *                               dosadit cizí klíč by byl únik, ne fallback
 *   neuvedeno, endpoint z prostředí
 *                             → klíč spárovaný s tímtéž zdrojem (bez něj bez
 *                               hlavičky); klíč OpenAI jen endpointu OpenAI
 */
function resolveApiKey(req: CompletionRequest, source: EndpointSource): { key: string | null; missing?: string } {
  if (req.auth_env_var === null) return { key: null };
  if (typeof req.auth_env_var === 'string') {
    const key = nonEmpty(req.api_key) ?? nonEmpty(process.env[req.auth_env_var]);
    return key ? { key } : { key: null, missing: `auth_env_var=${req.auth_env_var} není v prostředí` };
  }
  const explicit = nonEmpty(req.api_key);
  if (explicit) return { key: explicit };
  switch (source) {
    case 'caller':
      return { key: null, missing: 'backend nedeklaroval auth_env_var a volající nepředal klíč — cizí klíč se nedosazuje' };
    case 'RAG_JUDGE_BASE_URL':
      return { key: nonEmpty(process.env.RAG_JUDGE_API_KEY) };
    case 'VLLM_GENERATION_URL':
      return { key: nonEmpty(process.env.VLLM_API_KEY) };
    case 'openai': {
      const key = nonEmpty(config.openaiApiKey);
      return key ? { key } : { key: null, missing: 'endpoint OpenAI bez OPENAI_API_KEY' };
    }
  }
}

/**
 * Dispatch to the native provider protocol via @aisha/llm-dispatch (Gemini
 * generateContent, Anthropic /v1/messages). Same LlmCompletionError contract as
 * the OpenAI-compat path below — a missing/invalid key throws, never a silent
 * fallback (fail-loud).
 */
async function chatCompletionNative(req: CompletionRequest, providerSlug: string): Promise<CompletionResult> {
  // Endpoint nativního poskytovatele určuje protokol, ne prostředí — klíč tedy
  // jen z prohlášení backendu nebo od volajícího, nikdy klíč OpenAI.
  const { key: apiKey, missing } = resolveApiKey(req, 'caller');
  if (!apiKey) {
    throw new LlmCompletionError(
      503,
      `No API key resolved for LLM completion (provider=${providerSlug})${missing ? `: ${missing}` : ''}`,
    );
  }

  const backend = providerSlug === 'google-genai' ? new GeminiBackend(apiKey) : new AnthropicBackend(apiKey);

  const systemMsg = req.messages.find((m) => m.role === 'system');
  const dispatchReq: DispatchChatRequest = {
    model: req.model,
    systemPrompt: systemMsg?.content,
    messages: req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content })),
    temperature: req.temperature ?? 0,
    maxTokens: req.max_tokens ?? 1024,
    jsonMode: req.json_mode,
  };

  const started = Date.now();
  let res: Awaited<ReturnType<typeof backend.chat>>;
  try {
    res = await backend.chat(dispatchReq);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LlmCompletionError(502, `LLM completion (${providerSlug}) failed: ${msg}`);
  }

  return {
    text: res.text,
    usage: {
      prompt_tokens: res.usage.inputTokens,
      completion_tokens: res.usage.outputTokens,
      total_tokens: res.usage.inputTokens + res.usage.outputTokens,
    },
    model: res.model,
    finish_reason: res.isToolCall ? 'tool_calls' : 'stop',
    latency_ms: Date.now() - started,
  };
}

/**
 * Call an OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Throws LlmCompletionError on transport / non-2xx / shape failures.
 * Caller is responsible for retry+backoff (callers in the eval pipeline
 * wrap this with a 3-attempt backoff per the tolerant orchestration rule).
 */
export async function chatCompletion(req: CompletionRequest): Promise<CompletionResult> {
  if (req.provider_slug && NATIVE_PROTOCOL_PROVIDERS.has(req.provider_slug)) {
    return chatCompletionNative(req, req.provider_slug);
  }

  const endpoint = resolveBaseUrl(req.base_url);
  if (!endpoint) {
    throw new LlmCompletionError(
      503,
      'LLM endpoint není deklarovaný — předej base_url z resolveru, nebo nastav ' +
        'RAG_JUDGE_BASE_URL / VLLM_GENERATION_URL / OPENAI_API_BASE_URL',
    );
  }
  const { url: baseUrl, source } = endpoint;
  // Klíč jen ten, který patří tomuto endpointu (viz resolveApiKey). Chybí-li
  // klíč, který endpoint vyžaduje, padáme nahlas — nic neodejde.
  const { key: apiKey, missing } = resolveApiKey(req, source);
  const timeoutMs = req.timeout_ms ?? 90_000;

  if (missing) {
    throw new LlmCompletionError(503, `No API key resolved for LLM completion (${missing})`);
  }

  const url = `${baseUrl}/chat/completions`;
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0,
    max_tokens: req.max_tokens ?? 1024,
  };
  if (req.json_mode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (req.signal) {
    req.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      // Hlavička jen když klíč SKUTEČNĚ je — `Bearer undefined` je horší než
      // žádná hlavička: lokální server ji přijme a chová se, jako by šlo o
      // platnou identitu. Týž tvar jako embed-dispatcher.ts.
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new LlmCompletionError(504, `LLM completion timed out after ${timeoutMs}ms`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new LlmCompletionError(502, `LLM completion network error: ${msg}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => '(empty)');
    throw new LlmCompletionError(res.status, `LLM provider returned ${res.status}`, text.slice(0, 500));
  }

  const json = (await res.json()) as unknown;
  if (typeof json !== 'object' || json === null) {
    throw new LlmCompletionError(502, 'LLM provider returned non-object body');
  }
  const obj = json as Record<string, unknown>;
  const choices = obj.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined;
  const choice = choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string') {
    throw new LlmCompletionError(502, 'LLM provider returned no choices[0].message.content');
  }
  const usage = (obj.usage ?? {}) as Record<string, unknown>;
  return {
    text: content,
    usage: {
      prompt_tokens: Number(usage.prompt_tokens ?? 0),
      completion_tokens: Number(usage.completion_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? 0),
    },
    model: typeof obj.model === 'string' ? obj.model : req.model,
    finish_reason: choice?.finish_reason ?? 'unknown',
    latency_ms: Date.now() - started,
  };
}

/**
 * Retry wrapper with exponential backoff. Used by judge functions per the
 * AISHA tolerant-orchestration rule. Retries only on 5xx / network errors,
 * not on 4xx (caller mistake — retry would be wasted).
 */
export async function chatCompletionWithRetry(
  req: CompletionRequest,
  attempts = 3,
  backoffMs = 1000,
): Promise<CompletionResult> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await chatCompletion(req);
    } catch (err) {
      lastErr = err;
      const status = err instanceof LlmCompletionError ? err.statusCode : 0;
      const retryable = status === 0 || status === 502 || status === 503 || status === 504 || status === 429;
      if (!retryable || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i)));
    }
  }
  throw lastErr;
}
