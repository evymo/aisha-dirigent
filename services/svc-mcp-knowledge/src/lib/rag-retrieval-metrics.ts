/**
 * Rank-aware retrieval-quality metrics for the RAG embedding-model sweep (brick 1).
 *
 * THE metric for CHOOSING an embedding model: does a given embedding SPACE retrieve the
 * right chunks for a query? Orthogonal to the RAGAS generation-quality judges in
 * rag-eval-judges.ts (faithfulness/relevancy) — those measure the LLM's answer, these
 * measure the retrieval index. Pure set/rank math: NO generation, NO LLM judge,
 * deterministic and cheap. Computed from the ORDERED retrieved chunk slugs (search rank
 * order) vs the ground-truth relevant set (rag_eval_golden.expected_chunk_slugs).
 *
 * A row whose ground-truth set is empty is UNSCORED for retrieval (num_expected=0) — the
 * caller must exclude it from the aggregate rather than treat 0 as a real score.
 */

export interface RetrievalMetrics {
  /** |distinct relevant in top-K| / |expected|. 0 when there is no ground truth. */
  recall_at_k: number;
  /** Normalized discounted cumulative gain @K (binary relevance). 0 when no ground truth. */
  ndcg_at_k: number;
  /** Reciprocal rank of the first relevant retrieved chunk (1-based); 0 if none. */
  mrr: number;
  /** The K actually used (min of the requested K and the retrieved length). */
  k: number;
  /** Size of the ground-truth relevant set; 0 ⇒ this row is unscored for retrieval. */
  num_expected: number;
  /** Distinct relevant chunks present in the top-K. */
  num_relevant_retrieved: number;
}

function log2(n: number): number {
  return Math.log(n) / Math.LN2;
}

function cleanSlugs(slugs: ReadonlyArray<string | null | undefined>): string[] {
  return slugs.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/**
 * Does a retrieved chunk slug satisfy an expected golden label?
 *
 * Retrieved slugs are chunk-positional: `<source_slug>:<chunk_index>` (computed in
 * mcp_search_knowledge_v3 as COALESCE(source_slug, id) || ':' || chunk_index).
 * Expected labels may be EITHER:
 *   - item-level  — a bare `<source_slug>` (robust to re-chunking; the preferred
 *     labeling granularity — a label never silently rots when the chunker changes), OR
 *   - chunk-level — an exact `<source_slug>:<chunk_index>` (finer-grained).
 * An item-level label matches ANY chunk of that item; a chunk-level label matches
 * only that exact chunk. The chunk_index is the last ':'-segment (source_slugs are
 * kebab-case or uuids and never end in `:<int>`).
 *
 * ⛔ PŘESUNUTO SEM 2026-09-13 z rag-eval-judges.ts (tam zůstává re-export). Tuhle shodu
 * znaly jen set-based RAGAS metriky; rank-aware skóre níž — to, podle kterého
 * `fn_compare_rag_embedding_models` vybírá vítěze — porovnávalo PŘESNĚ. Golden set nese
 * slugy položek, v3 vrací `položka:index`, takže i dokonalý retrieval měl nDCG 0 a každé
 * srovnání embedding modelů skončilo „tie". Integrační test to neviděl: mockoval
 * chunk_slug rovnou slugem položky. Jedna definice shody pro obě metriky.
 */
export function slugMatches(retrievedSlug: string, expectedSlug: string): boolean {
  if (retrievedSlug === expectedSlug) return true; // chunk-level exact
  const i = retrievedSlug.lastIndexOf(':');
  const retrievedSource = i > 0 ? retrievedSlug.slice(0, i) : retrievedSlug;
  return retrievedSource === expectedSlug; // item-level: expected is the source_slug
}

/** Který očekávaný label retrieved chunk zasahuje (první shoda), nebo null. */
function matchExpected(retrieved: string, expected: ReadonlySet<string>): string | null {
  for (const e of expected) if (slugMatches(retrieved, e)) return e;
  return null;
}

/**
 * Score one query's retrieval. `retrievedSlugs` MUST be in search-rank order (best first).
 * `k` defaults to the full retrieved length. Each relevant slug counts once, at its best
 * rank (distinct-document semantics) so a duplicate slug never inflates recall/nDCG.
 */
export function scoreRetrieval(
  retrievedSlugs: ReadonlyArray<string | null | undefined>,
  expectedSlugs: ReadonlyArray<string | null | undefined>,
  k?: number,
): RetrievalMetrics {
  const expected = new Set(cleanSlugs(expectedSlugs));
  const ordered = cleanSlugs(retrievedSlugs);
  const kEff = Math.max(0, Math.min(k ?? ordered.length, ordered.length));
  const topK = ordered.slice(0, kEff);

  const numExpected = expected.size;
  if (numExpected === 0) {
    return { recall_at_k: 0, ndcg_at_k: 0, mrr: 0, k: kEff, num_expected: 0, num_relevant_retrieved: 0 };
  }

  const relevantSeen = new Set<string>();
  let dcg = 0;
  let firstRelevantRank = 0;
  topK.forEach((retrievedSlug, idx) => {
    const slug = matchExpected(retrievedSlug, expected);
    if (slug === null || relevantSeen.has(slug)) return; // count each relevant slug once
    const rank = idx + 1; // 1-based
    relevantSeen.add(slug);
    dcg += 1 / log2(rank + 1);
    if (firstRelevantRank === 0) firstRelevantRank = rank;
  });

  const numRelevantRetrieved = relevantSeen.size;
  const recallAtK = numRelevantRetrieved / numExpected;

  // Ideal DCG: all relevant ranked first, capped at K.
  const idealHits = Math.min(numExpected, kEff);
  let idcg = 0;
  for (let i = 1; i <= idealHits; i++) idcg += 1 / log2(i + 1);
  const ndcgAtK = idcg > 0 ? dcg / idcg : 0;

  return {
    recall_at_k: recallAtK,
    ndcg_at_k: ndcgAtK,
    mrr: firstRelevantRank > 0 ? 1 / firstRelevantRank : 0,
    k: kEff,
    num_expected: numExpected,
    num_relevant_retrieved: numRelevantRetrieved,
  };
}

/**
 * Aggregate per-query retrieval metrics into a mean over the SCORED rows only (rows with
 * a ground-truth set). Returns null counts/means when nothing was scorable.
 */
export function aggregateRetrieval(rows: ReadonlyArray<RetrievalMetrics>): {
  recall_at_k: number;
  ndcg_at_k: number;
  mrr: number;
  scored_rows: number;
  skipped_no_ground_truth: number;
} {
  const scored = rows.filter((r) => r.num_expected > 0);
  const n = scored.length;
  const mean = (sel: (r: RetrievalMetrics) => number): number =>
    n === 0 ? 0 : scored.reduce((acc, r) => acc + sel(r), 0) / n;
  return {
    recall_at_k: mean((r) => r.recall_at_k),
    ndcg_at_k: mean((r) => r.ndcg_at_k),
    mrr: mean((r) => r.mrr),
    scored_rows: n,
    skipped_no_ground_truth: rows.length - n,
  };
}
