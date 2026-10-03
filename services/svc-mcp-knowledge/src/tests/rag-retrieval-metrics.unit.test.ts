/**
 * Unit tests for the rank-aware retrieval scorer (RAG brick 1) — the metric for CHOOSING
 * an embedding model. Pure math, no DB, no LLM. Pins Recall@K / nDCG@K / MRR semantics +
 * the "no ground truth ⇒ unscored" contract that the sweep aggregate relies on.
 */
import { describe, it, expect } from 'vitest';
import { scoreRetrieval, aggregateRetrieval } from '../lib/rag-retrieval-metrics.js';

const NDCG_RANK2 = 1 / (Math.log(3) / Math.LN2); // gain at rank 2, IDCG=1 ⇒ ≈0.63093

describe('scoreRetrieval — rank-aware retrieval metrics', () => {
  it('perfect retrieval (all expected first, in order) ⇒ recall=ndcg=mrr=1', () => {
    const m = scoreRetrieval(['a', 'b', 'c'], ['a', 'b']);
    expect(m.recall_at_k).toBe(1);
    expect(m.ndcg_at_k).toBeCloseTo(1, 10);
    expect(m.mrr).toBe(1);
    expect(m.num_expected).toBe(2);
    expect(m.num_relevant_retrieved).toBe(2);
  });

  it('no relevant retrieved ⇒ all 0 but still scored (num_expected>0)', () => {
    const m = scoreRetrieval(['x', 'y'], ['a']);
    expect(m.recall_at_k).toBe(0);
    expect(m.ndcg_at_k).toBe(0);
    expect(m.mrr).toBe(0);
    expect(m.num_expected).toBe(1);
  });

  it('one relevant at rank 2 (expected size 1) ⇒ recall=1, mrr=0.5, ndcg=gain@2/IDCG', () => {
    const m = scoreRetrieval(['x', 'a'], ['a']);
    expect(m.recall_at_k).toBe(1);
    expect(m.mrr).toBe(0.5);
    expect(m.ndcg_at_k).toBeCloseTo(NDCG_RANK2, 10);
  });

  it('no ground truth (empty expected) ⇒ UNSCORED: num_expected=0, metrics 0', () => {
    const m = scoreRetrieval(['a', 'b'], []);
    expect(m.num_expected).toBe(0);
    expect(m.recall_at_k).toBe(0);
    expect(m.mrr).toBe(0);
  });

  it('Recall@K truncates: K=1 of 2 expected, top-1 relevant ⇒ recall=0.5', () => {
    const m = scoreRetrieval(['a', 'x', 'b'], ['a', 'b'], 1);
    expect(m.k).toBe(1);
    expect(m.recall_at_k).toBe(0.5);
    expect(m.mrr).toBe(1);
    expect(m.ndcg_at_k).toBeCloseTo(1, 10); // single relevant at rank 1, IDCG capped at K=1
  });

  it('filters null/empty slugs on both sides', () => {
    const m = scoreRetrieval(['a', null, '', 'b'], ['a', '', null as unknown as string]);
    expect(m.num_expected).toBe(1);
    expect(m.recall_at_k).toBe(1);
  });

  it('⛔ v3 chunk_slug `<položka>:<index>` zasahuje golden slug POLOŽKY (dřív nDCG vždy 0)', () => {
    // mcp_search_knowledge_v3: (COALESCE(ki.source_slug, ki.id::text) || ':' || kc.chunk_index)
    const m = scoreRetrieval(['jina-polozka:0', 'aisha-platform-overview:2', 'aisha-platform-overview:0'], ['aisha-platform-overview']);
    expect(m.num_relevant_retrieved).toBe(1); // dva chunky téže položky = jedna položka
    expect(m.recall_at_k).toBe(1);
    expect(m.mrr).toBe(0.5);
    expect(m.ndcg_at_k).toBeCloseTo(NDCG_RANK2, 10);
  });

  it('golden smí jmenovat konkrétní chunk; jiný index téže položky ho nezasáhne', () => {
    expect(scoreRetrieval(['polozka:1'], ['polozka:1']).recall_at_k).toBe(1);
    expect(scoreRetrieval(['polozka:0'], ['polozka:1']).recall_at_k).toBe(0);
    // Podřetězec slugu není shoda.
    expect(scoreRetrieval(['polozka-dalsi:0'], ['polozka']).recall_at_k).toBe(0);
  });

  it('a duplicate relevant slug counts once (distinct-document semantics)', () => {
    const m = scoreRetrieval(['a', 'a'], ['a']);
    expect(m.num_relevant_retrieved).toBe(1);
    expect(m.recall_at_k).toBe(1);
    expect(m.ndcg_at_k).toBeCloseTo(1, 10);
  });
});

describe('aggregateRetrieval — mean over SCORED rows only', () => {
  it('skips no-ground-truth rows and means the rest', () => {
    const agg = aggregateRetrieval([
      scoreRetrieval(['a'], ['a']), // recall 1
      scoreRetrieval(['x'], ['a']), // recall 0
      scoreRetrieval(['a'], []), // unscored (no ground truth)
    ]);
    expect(agg.scored_rows).toBe(2);
    expect(agg.skipped_no_ground_truth).toBe(1);
    expect(agg.recall_at_k).toBe(0.5);
  });

  it('empty / all-unscored ⇒ 0 means, 0 scored', () => {
    const agg = aggregateRetrieval([scoreRetrieval(['a'], [])]);
    expect(agg.scored_rows).toBe(0);
    expect(agg.recall_at_k).toBe(0);
  });
});
