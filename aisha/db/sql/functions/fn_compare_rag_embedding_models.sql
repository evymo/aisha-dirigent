-- Function: fn_compare_rag_embedding_models
-- The brick-1 verdict: head-to-head comparison of TWO embedding models on the SAME golden
-- set, per (context_profile, language). The existing baseline RPCs bucket BY embedding_model
-- but never DIFF two buckets, and the regression detector compares a group only to its OWN
-- time-series — neither can answer "which embedding space retrieves better for THIS context".
--
-- The winner is decided by nDCG@K (the retrieval north-star for CHOOSING an embedding model —
-- rank-aware, computed from expected_chunk_slugs, independent of the LLM answer). composite_score
-- (RAGAS generation quality) is returned alongside for context but does NOT pick the winner: a
-- better answer with worse retrieval is the LLM compensating, not a better index.
--
-- Only retrieval-SCORED runs (metadata.retrieval.num_expected > 0) feed the nDCG/recall/MRR
-- means; if the golden set is not yet labelled with expected_chunk_slugs for a group, the
-- winner is 'insufficient_data' (NOT a fabricated tie) — the honest "needs a labelled golden"
-- signal. This is the head-to-head AISHA reads to pin embedding_model_pref per context (brick 2).

CREATE OR REPLACE FUNCTION public.fn_compare_rag_embedding_models(
  p_model_a text,
  p_model_b text,
  p_period_hours integer DEFAULT 168
)
 RETURNS TABLE(
   context_profile_slug text,
   language text,
   a_ndcg numeric, b_ndcg numeric,
   a_recall numeric, b_recall numeric,
   a_mrr numeric, b_mrr numeric,
   a_composite numeric, b_composite numeric,
   a_scored_rows bigint, b_scored_rows bigint,
   ndcg_delta numeric,
   winner text
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_model_a IS NULL OR p_model_b IS NULL OR p_model_a = p_model_b THEN
    RAISE EXCEPTION 'p_model_a and p_model_b are required and must differ';
  END IF;

  RETURN QUERY
  WITH runs AS (
    SELECT
      r.embedding_model,
      r.context_profile_slug AS cps,
      COALESCE(r.metadata->>'language', 'unknown') AS lang,
      r.composite_score AS composite,
      NULLIF(r.metadata->'retrieval'->>'num_expected', '')::int     AS num_expected,
      NULLIF(r.metadata->'retrieval'->>'ndcg_at_k', '')::numeric     AS ndcg,
      NULLIF(r.metadata->'retrieval'->>'recall_at_k', '')::numeric   AS recall,
      NULLIF(r.metadata->'retrieval'->>'mrr', '')::numeric           AS mrr
    FROM public.rag_eval_runs r
    WHERE r.embedding_model IN (p_model_a, p_model_b)
      AND r.created_at >= now() - make_interval(hours => p_period_hours)
  ),
  agg AS (
    SELECT
      cps, lang, embedding_model,
      round(avg(ndcg)   FILTER (WHERE num_expected > 0), 4) AS ndcg,
      round(avg(recall) FILTER (WHERE num_expected > 0), 4) AS recall,
      round(avg(mrr)    FILTER (WHERE num_expected > 0), 4) AS mrr,
      round(avg(composite), 3)                              AS composite,
      count(*) FILTER (WHERE num_expected > 0)              AS scored_rows
    FROM runs
    GROUP BY cps, lang, embedding_model
  )
  SELECT
    COALESCE(a.cps, b.cps),
    COALESCE(a.lang, b.lang),
    a.ndcg, b.ndcg, a.recall, b.recall, a.mrr, b.mrr,
    a.composite, b.composite,
    COALESCE(a.scored_rows, 0), COALESCE(b.scored_rows, 0),
    round(COALESCE(a.ndcg, 0) - COALESCE(b.ndcg, 0), 4) AS ndcg_delta,
    CASE
      WHEN a.ndcg IS NULL AND b.ndcg IS NULL THEN 'insufficient_data'
      WHEN COALESCE(a.ndcg, -1) > COALESCE(b.ndcg, -1) THEN p_model_a
      WHEN COALESCE(b.ndcg, -1) > COALESCE(a.ndcg, -1) THEN p_model_b
      ELSE 'tie'
    END AS winner
  FROM (SELECT * FROM agg WHERE embedding_model = p_model_a) a
  FULL OUTER JOIN (SELECT * FROM agg WHERE embedding_model = p_model_b) b
    ON a.cps IS NOT DISTINCT FROM b.cps
   AND a.lang = b.lang
  ORDER BY 1, 2;
END;
$function$
;

REVOKE ALL ON FUNCTION fn_compare_rag_embedding_models(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_compare_rag_embedding_models(text, text, integer) TO service_role;
