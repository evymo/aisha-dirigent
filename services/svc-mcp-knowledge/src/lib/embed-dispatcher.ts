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
 *
 * LANE NA GPU (varianta C, 2026-10-05): vLLM kinds (`vllm`, `local_vllm`) mohou stát za
 * vynucovacím bodem společné lane. Ten chce u KAŽDÉHO požadavku třídu (`x-aisha-trida`,
 * výchozí se nedosazuje), odmítá uzavřeným slovníkem `{duvod, error}` a k odpovědi přidává
 * identitu vah (`x-aisha-identita`). Slovník i jména hlaviček jsou v `@aisha/accel-protokol`
 * — tady se importují, neopisují.
 */
import { HLAVICKY, jeDuvod, type Duvod, type Trida } from '@aisha/accel-protokol';

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
  /**
   * Třída požadavku pro lane (`x-aisha-trida`): `dotaz` (interaktivní) | `davka` (přepočet).
   * U vLLM kinds POVINNÁ — lane bez ní odmítne (POZADAVEK_NEPLATNY) a výchozí se nedosazuje.
   */
  trida?: Trida;
}

/** Identita vah, kterou lane k odpovědi připojila (EM2): `<formát>:<sha256>` + revize + recept. */
export interface IdentitaVah {
  identita: string;
  revize: string | null;
  recept: string;
}

/** Vektory + identita vah, které je spočítaly (null = backend identitu neposílá, např. llama.cpp). */
export interface EmbedVysledek {
  vectors: number[][];
  identita: IdentitaVah | null;
}

export class EmbedDispatchError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public providerBody?: string,
    /** Kód odmítnutí lane ze slovníku @aisha/accel-protokol (jen když ho tělo neslo). */
    public duvod?: Duvod,
    /** Kdo odmítl (`x-aisha-odmitl`: vstup | klient | most). */
    public odmitl?: string,
    /** U KVOTA_PREKROCENA: která kvóta došla (`kvota` z těla odmítnutí). */
    public kvota?: string,
    /** Sekundy z `Retry-After` (jen nezáporné číslo; HTTP datum ani nic jiného = null, neodhaduje se). */
    public znovuZaS: number | null = null,
  ) {
    super(message);
    this.name = 'EmbedDispatchError';
  }
}

/** vLLM kinds — ty mohou stát za lane na GPU, takže nesou její požadavky (třída, klíč). */
export function jeVllmKind(kind: EmbedBackendKind): boolean {
  return kind === 'vllm' || kind === 'local_vllm';
}

const TVAR_IDENTITY = /^[A-Za-z0-9._-]+:[0-9a-f]{64}$/;

/**
 * Chybu z ne-2xx odpovědi sestaví s KÓDEM lane, když ho tělo nese (`{duvod, error}`).
 * Volající se podle kódu rozhodne (LANE_STARTUJE/LANE_NEDOSTUPNA = vrstva stojí, nahlas;
 * ENGINE_ODMITL = vstup nad oknem; KVOTA_PREKROCENA = počkat) — žádný návrat na jiný model.
 */
async function chybaZOdpovedi(res: Response, kontext: string): Promise<EmbedDispatchError> {
  const text = await res.text().catch(() => '');
  let duvod: Duvod | undefined;
  let popis = '';
  let kvota: string | undefined;
  try {
    const telo = JSON.parse(text) as { duvod?: unknown; error?: unknown; kvota?: unknown };
    if (telo && jeDuvod(telo.duvod)) {
      duvod = telo.duvod;
      popis = typeof telo.error === 'string' ? telo.error : '';
      kvota = typeof telo.kvota === 'string' ? telo.kvota : undefined;
    }
  } catch {
    // tělo není JSON — chyba bez kódu lane
  }
  const odmitl = res.headers.get(HLAVICKY.ODMITL) ?? undefined;
  const zprava = duvod
    ? `lane odmítla ${kontext}: ${duvod}${popis ? ` — ${popis}` : ''}${odmitl ? ` (odmítl: ${odmitl})` : ''}`
    : `${kontext}: provider returned ${res.status}`;
  return new EmbedDispatchError(res.status, zprava, text.slice(0, 500), duvod, odmitl, kvota, znovuZa(res));
}

/** `Retry-After` ve vteřinách; cokoli jiného než nezáporné číslo (i HTTP datum) = null. */
function znovuZa(res: Response): number | null {
  const h = res.headers.get('retry-after');
  if (h === null || !/^\d+(\.\d+)?$/.test(h.trim())) return null;
  return Number(h.trim());
}

/**
 * Identita vah z hlaviček odpovědi. Chybí-li `x-aisha-identita`, backend ji neposílá (null).
 * Je-li, musí mít tvar `<formát>:<sha256>` a recept — neúplnou nebo vadnou identitu nelze
 * k vektoru uložit (E2), takže je to chyba, ne „bez identity“.
 */
function identitaZOdpovedi(res: Response, kontext: string): IdentitaVah | null {
  const identita = res.headers.get(HLAVICKY.IDENTITA);
  if (identita === null) return null;
  const recept = res.headers.get(HLAVICKY.RECEPT);
  if (!TVAR_IDENTITY.test(identita) || !recept) {
    throw new EmbedDispatchError(
      502,
      `${kontext}: identita vah v odpovědi je neúplná nebo vadná (identita='${identita.slice(0, 80)}', recept=${recept ? 'ano' : 'chybí'}) — vektor nelze přiřadit`,
    );
  }
  return { identita, revize: res.headers.get(HLAVICKY.REVIZE), recept };
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
  return (await embedSIdentitou(opts)).vectors;
}

/**
 * Jako `embed()`, a navíc identita vah, které vektory spočítaly (lane ji posílá v hlavičkách).
 * Kdo vektory UKLÁDÁ, volá tuhle — identita patří k vektoru (E2).
 */
export async function embedSIdentitou(opts: EmbedOptions): Promise<EmbedVysledek> {
  const { texts, model, backendKind, apiKey } = opts;

  if (!model || model.trim().length === 0) {
    throw new EmbedDispatchError(500, 'embed(): model is required (the corpus/index model is never defaulted)');
  }
  if (texts.length === 0) return { vectors: [], identita: null };

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
  if (jeVllmKind(backendKind) && !opts.trida) {
    // Programová chyba volajícího: lane bez třídy odmítne a dosadit ji tady by rozhodlo za něj.
    throw new EmbedDispatchError(500, `embed(): třída požadavku (dotaz|davka) je u '${backendKind}' povinná — výchozí se nedosazuje`);
  }
  const base = rootBase(rawBase);
  const url = isOllama(backendKind) ? `${base}/api/embed` : `${base}/v1/embeddings`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey && apiKey.trim().length > 0) headers.Authorization = `Bearer ${apiKey}`;
  if (jeVllmKind(backendKind) && opts.trida) headers[HLAVICKY.TRIDA] = opts.trida;

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
    throw await chybaZOdpovedi(res, `embed (${backendKind})`);
  }

  const identita = identitaZOdpovedi(res, `embed (${backendKind})`);
  const json = (await res.json()) as unknown;
  if (typeof json !== 'object' || json === null) {
    throw new EmbedDispatchError(502, `embed provider returned non-object body (${backendKind})`);
  }

  if (isOllama(backendKind)) {
    const embeddings = (json as { embeddings?: unknown }).embeddings;
    if (!Array.isArray(embeddings)) {
      throw new EmbedDispatchError(502, 'ollama /api/embed response missing embeddings[]');
    }
    return { vectors: embeddings as number[][], identita };
  }

  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new EmbedDispatchError(502, 'embeddings response missing data[]');
  }
  const vectors = (data as Array<{ index: number; embedding: number[] }>)
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
  return { vectors, identita };
}

/**
 * Počet tokenů tak, jak je llama.cpp server (svc-model) předá modelu — TÝŽ tokenizér jako
 * kódování (`/extras/tokenize/count`, ověřeno na riq 2026-09-29: count = prompt_tokens).
 * Slouží k tomu, aby se text nad stropem (n_batch) NEKÓDOVAL: llama.cpp by ho tiše ořízl.
 * URL je odvozená z endpoint_url backendu (ai_provider_registry, ohraničeno DB) — stejný
 * původ jako embed() výš.
 *
 * Lane na GPU tuhle cestu NEMÁ (odmítne `CESTA_NEZNAMA`) a ořez nedělá: vstup nad oknem
 * odmítne `ENGINE_ODMITL`. Proto se posílá klíč i třída (jinak by lane odmítla dřív, kódem
 * KLIC_CHYBI, a volající by nepoznal, že mluví s lane) a chyba nese kód lane.
 */
export async function countTokens(
  url: string,
  model: string,
  text: string,
  timeoutMs = 30_000,
  pozadavek: { apiKey?: string; trida?: Trida } = {},
): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (pozadavek.apiKey && pozadavek.apiKey.trim().length > 0) headers.Authorization = `Bearer ${pozadavek.apiKey}`;
    if (pozadavek.trida) headers[HLAVICKY.TRIDA] = pozadavek.trida;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });
    if (!res.ok) throw await chybaZOdpovedi(res, 'tokenize/count');
    const body = (await res.json()) as { count?: unknown };
    if (typeof body.count !== 'number' || !Number.isFinite(body.count)) {
      throw new EmbedDispatchError(502, 'tokenize/count nevrátil číslo');
    }
    return body.count;
  } finally {
    clearTimeout(timer);
  }
}
