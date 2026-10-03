/**
 * embed-query-in-space — the shared query-embedding seam for RAG retrieval (Brick2-PIN).
 *
 * Both the eval harness (rag-eval.ts) and the prod search path (mcp.ts) must embed a query
 * with EXACTLY the model that produced the corpus they search, then send that vector to the
 * matching mcp_search_knowledge_v3 column (v1 vector(1024) | v2 halfvec(2560)). This module
 * lifts that logic out of rag-eval.ts so there is ONE place that:
 *   1. resolves the embedding backend (a NAMED model, or the model FOR a corpus space),
 *   2. embeds a single query string with it via the backend-agnostic embed-dispatcher,
 *   3. returns the vector + its rag_space + the model_id (the Brick2-guard identity),
 *      pre-branched into the v1/v2 query params mcp_search_knowledge_v3 expects.
 *
 * Invariant (model-as-index-constant): the embedding model is NEVER defaulted here — it is a
 * property of the corpus/index. An unresolvable model/space throws; the caller fails loud or
 * degrades to text-only, never silently embeds with a different-space model.
 */
import { rpcService } from '../postgrest.js';
import { embed, mapBackendKind } from './embed-dispatcher.js';

/** Backend + corpus space for an embedding model — the shape both resolvers RETURN. */
export interface EmbeddingBackend {
  model_id: string;
  provider_slug: string;
  backend_kind: string;
  endpoint_url: string | null;
  auth_env_var: string | null;
  embedding_dimensions: number | null;
  /** 'v1' (vector 1024) | 'v2' (halfvec 2560) — which corpus column retrieval targets. */
  rag_space: string;
}

/** A query embedded in a resolved space, pre-branched for mcp_search_knowledge_v3. */
export interface EmbeddedQuery {
  /** The resolved embedding backend (model_id is the Brick2-guard p_query_model). */
  backend: EmbeddingBackend;
  /** 'v1' | 'v2'. */
  ragSpace: string;
  /** The query vector, or null on the arm that does not match ragSpace. */
  queryEmbeddingV1: number[] | null;
  queryEmbeddingV2: number[] | null;
}

/** Read the API key the resolver pointed at (env var name → value), if any. */
function apiKeyForBackend(backend: EmbeddingBackend): string | undefined {
  return backend.auth_env_var ? process.env[backend.auth_env_var] : undefined;
}

/**
 * Korpusový prostor. Mapování prostor ↔ rozměr ↔ sloupec NEŽIJE tady: drží ho
 * `fn_resolve_embedding_model_for_space` (1024 → v1, 2560 → v2) a sloupce v DB
 * (v1: knowledge_embeddings.embedding, expert_rules.content_embedding,
 * agent_memories.embedding — vector(1024); v2: embedding_v2 — halfvec(2560)).
 * TypeScript jen říká, do KTERÉHO prostoru daná dráha zapisuje.
 */
export type RagSpace = 'v1' | 'v2';

/**
 * Embedding backend pro ZÁPIS do prostoru — týž resolver, jaký používá dotaz
 * (`embedQueryForProfile`), aby korpus i dotaz počítal model téhož prostoru.
 *
 * ⛔ NAMĚŘENO 2026-09-13: zápisové dráhy volaly `resolveRagBackend('rag.embedding')`
 * (aisha_resolve_clow_backend), který rozměr neřeší. S 1024 i 2560 modelem
 * dostupnými současně tak jedna z drah padala až při zápisu do sloupce; a dráha
 * pravidel šla natvrdo na OpenAI (1536) do vector(1024) — ta nemohla projít NIKDY.
 *
 * `null` = pro prostor není živý model; volající musí selhat HLASITĚ (503), nikdy
 * embedovat modelem jiného prostoru.
 */
export async function resolveEmbeddingBackendForSpace(space: RagSpace): Promise<EmbeddingBackend | null> {
  const [backend] = await rpcService<EmbeddingBackend[]>('fn_resolve_embedding_model_for_space', {
    p_context_profile_slug: null,
    p_rag_space: space,
  });
  return backend ?? null;
}

/**
 * Embeduj texty modelem, který resolver vydal pro prostor — a OVĚŘ rozměr.
 *
 * Kontrola délky tu není kvůli Postgresu (ten nesedící vektor odmítne taky), ale
 * kvůli MÍSTU chyby: tady nese jméno modelu, deklarovaný rozměr a skutečnou délku;
 * v DB by to bylo „expected 1024 dimensions, not 768" bez jediné stopy po příčině.
 */
export async function embedTextsWithBackend(
  backend: EmbeddingBackend,
  texts: string[],
): Promise<number[][]> {
  const vectors = await embed({
    texts,
    model: backend.model_id,
    backendKind: mapBackendKind(backend.backend_kind),
    apiKey: apiKeyForBackend(backend),
    baseUrl: backend.endpoint_url ?? undefined,
  });
  if (vectors.length !== texts.length) {
    throw new Error(
      `embedding backend ${backend.provider_slug}/${backend.model_id} vrátil ${vectors.length} vektorů na ${texts.length} textů`,
    );
  }
  const expected = backend.embedding_dimensions;
  const wrong = expected ? vectors.find((v) => v.length !== expected) : undefined;
  if (wrong) {
    throw new Error(
      `embedding backend ${backend.provider_slug}/${backend.model_id} vrátil vektor délky ${wrong.length}, ` +
        `registr vede ${expected} (prostor ${backend.rag_space}) — rozměr v registru neodpovídá obsluhovanému modelu`,
    );
  }
  return vectors;
}

/**
 * Embed one query string with an already-resolved embedding backend, branching the result
 * into the v1/v2 query params. The vector lands ONLY on the arm matching backend.rag_space —
 * the other arm is null, so v3 never cosine-compares across embedding spaces.
 */
export async function embedQueryWithBackend(
  backend: EmbeddingBackend,
  query: string,
): Promise<EmbeddedQuery> {
  const [vector] = await embed({
    texts: [query],
    model: backend.model_id,
    backendKind: mapBackendKind(backend.backend_kind),
    apiKey: apiKeyForBackend(backend),
    baseUrl: backend.endpoint_url ?? undefined,
    dimensions: backend.embedding_dimensions ?? undefined,
  });
  const isV2 = backend.rag_space === 'v2';
  return {
    backend,
    ragSpace: backend.rag_space,
    queryEmbeddingV1: isV2 ? null : vector,
    queryEmbeddingV2: isV2 ? vector : null,
  };
}

/**
 * Resolve a NAMED embedding model (fn_resolve_embedding_model) and embed the query with it.
 * Used by the eval harness, which deliberately names the model under test. Throws if the
 * named model has no live embedding backend (fail loud — never substitute another model).
 */
export async function embedQueryWithNamedModel(
  modelId: string,
  query: string,
): Promise<EmbeddedQuery> {
  const [backend] = await rpcService<EmbeddingBackend[]>('fn_resolve_embedding_model', {
    p_model_id: modelId,
  });
  if (!backend) {
    throw new Error(
      `Embedding model "${modelId}" is not resolvable — no enabled is_embedding provider serves it.`,
    );
  }
  return embedQueryWithBackend(backend, query);
}

/**
 * Resolve the live embedding model FOR a context profile's corpus space via
 * fn_resolve_embedding_model_for_space, then embed the query in that space. Used by the prod
 * search path: the function reads the profile's embedding_model_pref DB-side (RPC-only) so
 * the query is embedded in the SAME space the corpus was indexed in. `fallbackSpace` is used
 * when no profile slug is given or the profile has no pref. Throws if no live model targets
 * the resolved space (caller degrades to text-only — never embeds with a wrong-space model).
 */
export async function embedQueryForProfile(
  query: string,
  contextProfileSlug: string | null,
  fallbackSpace = 'v1',
): Promise<EmbeddedQuery> {
  const [backend] = await rpcService<EmbeddingBackend[]>('fn_resolve_embedding_model_for_space', {
    p_context_profile_slug: contextProfileSlug,
    p_rag_space: fallbackSpace,
  });
  if (!backend) {
    throw new Error(
      `No live embedding model resolvable for context profile "${contextProfileSlug ?? fallbackSpace}" — degrade to text-only.`,
    );
  }
  return embedQueryWithBackend(backend, query);
}
