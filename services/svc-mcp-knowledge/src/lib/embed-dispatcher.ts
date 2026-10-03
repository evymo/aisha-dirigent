/**
 * Backend-agnostic embedding dispatcher — the embedding twin of
 * llm-completion.ts:chatCompletion. One helper that produces vectors from ANY
 * OpenAI-compatible embeddings endpoint (OpenAI / vLLM / LM Studio) and from
 * Ollama, branching only on backend_kind. This is RAG Brick 0: nothing
 * downstream (eval harness, model pinning, cross-lingual retrieval) can produce
 * a non-OpenAI multilingual embedding until this exists.
 *
 * Invariant: the embedding model is NEVER defaulted here — it is a required arg.
 * The model is a property of the corpus/index (see the multilingual-RAG RFC),
 * not a per-call dispatcher choice; the caller resolves it (config default for
 * the OpenAI path, the RAG backend's model_id for the v2 path).
 */

/** OpenAI-compatible kinds POST {base}/v1/embeddings; ollama POSTs {base}/api/embed. */
export type EmbedBackendKind =
  | 'openai'
  | 'direct_cloud'
  | 'vllm'
  | 'local_vllm'
  | 'lmstudio'
  | 'mcp_server'
  | 'ollama';

/**
 * Map an ai_provider_registry backend_kind to the embed-dispatcher wire protocol.
 * Shared by every embedding caller (ingest + eval/sweep) so the registry→protocol
 * mapping lives in exactly one place.
 */
export function mapBackendKind(kind: string): EmbedBackendKind {
  switch (kind) {
    case 'local_ollama':
      return 'ollama';
    case 'local_vllm':
      return 'local_vllm';
    case 'mcp_server':
      return 'mcp_server';
    case 'llm_gateway':
      return 'openai'; // OpenAI-compatible, addressed via endpoint_url
    case 'direct_cloud':
    default:
      return 'direct_cloud';
  }
}

export interface EmbedOptions {
  /** Texts to embed; an empty array short-circuits to [] (no request). */
  texts: string[];
  /** REQUIRED — never defaulted. The corpus/index model id. */
  model: string;
  /** Selects the wire protocol + default base. */
  backendKind: EmbedBackendKind;
  /** Endpoint base. Required for every non-OpenAI kind; defaults to OpenAI for openai/direct_cloud. */
  baseUrl?: string;
  /** Bearer key. Optional — local vLLM/LM Studio/Ollama usually need none. */
  apiKey?: string;
  /** Matryoshka (MRL) output dimension for OpenAI-compatible backends that support it
   *  (OpenAI text-embedding-3-*, vLLM). Lets a model emit the exact index dimension
   *  (e.g. 2560 for the v2 halfvec column). Ignored by Ollama (model-fixed). */
  dimensions?: number;
  /** Per-request timeout (default 60000). */
  timeoutMs?: number;
}

export class EmbedDispatchError extends Error {
  constructor(public statusCode: number, message: string, public providerBody?: string) {
    super(message);
    this.name = 'EmbedDispatchError';
  }
}

const OPENAI_DEFAULT_BASE = 'https://api.openai.com';

/** Strip trailing slashes and a trailing /v1 so we can re-append the exact suffix per protocol. */
function rootBase(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function isOllama(kind: EmbedBackendKind): boolean {
  return kind === 'ollama';
}

/**
 * Embed `texts` with `model` against the backend selected by `backendKind`.
 * Returns one vector per input text, in input order. Throws EmbedDispatchError
 * on missing config / non-2xx / shape failures (caller owns retry+backoff).
 */
export async function embed(opts: EmbedOptions): Promise<number[][]> {
  const { texts, model, backendKind, apiKey } = opts;

  if (!model || model.trim().length === 0) {
    throw new EmbedDispatchError(500, 'embed(): model is required (the corpus/index model is never defaulted)');
  }
  if (texts.length === 0) return [];

  // Resolve the base. OpenAI/direct_cloud fall back to the public endpoint; every
  // other kind MUST be given a baseUrl (there is no sane default for a local box).
  const rawBase =
    opts.baseUrl && opts.baseUrl.trim().length > 0
      ? opts.baseUrl
      : backendKind === 'openai' || backendKind === 'direct_cloud'
        ? OPENAI_DEFAULT_BASE
        : '';
  if (!rawBase) {
    throw new EmbedDispatchError(503, `embed(): no baseUrl resolved for backendKind='${backendKind}'`);
  }
  const base = rootBase(rawBase);
  const url = isOllama(backendKind) ? `${base}/api/embed` : `${base}/v1/embeddings`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey && apiKey.trim().length > 0) headers.Authorization = `Bearer ${apiKey}`;

  const timeoutMs = opts.timeoutMs ?? 60_000;
  // Both wire formats accept {model, input}. OpenAI/vLLM also accept an MRL
  // `dimensions`; Ollama is model-fixed, so we only send it to the OpenAI shape.
  // (Ollama's /api/embed returns {embeddings}; the OpenAI shape {data:[{index,embedding}]}.)
  const payload: Record<string, unknown> = { model, input: texts };
  if (opts.dimensions && !isOllama(backendKind)) payload.dimensions = opts.dimensions;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new EmbedDispatchError(504, `embed timed out after ${timeoutMs}ms (${backendKind})`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new EmbedDispatchError(502, `embed network error (${backendKind}): ${msg}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => '(empty)');
    throw new EmbedDispatchError(res.status, `embed provider returned ${res.status} (${backendKind})`, body.slice(0, 500));
  }

  const json = (await res.json()) as unknown;
  if (typeof json !== 'object' || json === null) {
    throw new EmbedDispatchError(502, `embed provider returned non-object body (${backendKind})`);
  }

  if (isOllama(backendKind)) {
    const embeddings = (json as { embeddings?: unknown }).embeddings;
    if (!Array.isArray(embeddings)) {
      throw new EmbedDispatchError(502, 'ollama /api/embed response missing embeddings[]');
    }
    return embeddings as number[][];
  }

  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new EmbedDispatchError(502, 'embeddings response missing data[]');
  }
  return (data as Array<{ index: number; embedding: number[] }>)
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Počet tokenů tak, jak je llama.cpp server (svc-model) předá modelu — TÝŽ tokenizér jako
 * kódování (`/extras/tokenize/count`, ověřeno na riq 2026-09-29: count = prompt_tokens).
 * Slouží k tomu, aby se text nad stropem (n_batch) NEKÓDOVAL: llama.cpp by ho tiše ořízl.
 * URL je odvozená z endpoint_url backendu (ai_provider_registry, ohraničeno DB) — stejný
 * původ jako embed() výš.
 */
export async function countTokens(url: string, model: string, text: string, timeoutMs = 30_000): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });
    if (!res.ok) throw new EmbedDispatchError(502, `tokenize/count HTTP ${res.status}`);
    const body = (await res.json()) as { count?: unknown };
    if (typeof body.count !== 'number' || !Number.isFinite(body.count)) {
      throw new EmbedDispatchError(502, 'tokenize/count nevrátil číslo');
    }
    return body.count;
  } finally {
    clearTimeout(timer);
  }
}
