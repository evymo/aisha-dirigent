-- ============================================================================
-- Source of Truth: fn_get_rag_baseline
-- Popis: Aggregated retrieval-quality metrics for the last N hours, grouped
--        by (context_profile_slug, embedding_model, llm_model). Used by:
--          - admin observability tile (src/pages/admin/AdminAiObservability.tsx)
--          - regression gate (src/tests/regression/rag_baseline.regression.test.ts)
--        Returns one row per (profile × embedding × llm) bucket present in
--        rag_eval_runs within the rolling window.
--
-- Step:  Step 0 of retrieval optimization plan 2026
-- Bezpečnost: SECURITY DEFINER + admin-or-staff (or service_role)
-- Audit:  N/A — read-only aggregation, no audit row to avoid log spam
-- Source migration: aisha/db/migrations/20260518200000_rag_eval_foundation.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_rag_baseline(
  p_profile_slug   text DEFAULT NULL,
  p_embedding_model text DEFAULT NULL,
  p_period_hours   integer DEFAULT 168
)
RETURNS TABLE (
  context_profile_slug    text,
  embedding_model         text,
  llm_model               text,
  n_runs                  bigint,
  faithfulness_avg        numeric,
  answer_relevancy_avg    numeric,
  context_precision_avg   numeric,
  context_recall_avg      numeric,
  composite_avg           numeric,
  faithfulness_p50        numeric,
  faithfulness_p90        numeric,
  period_start            timestamptz,
  period_end              timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.is_admin_or_staff(auth.uid()) OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'Admin/staff or service_role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.context_profile_slug,
    r.embedding_model,
    r.llm_model,
    count(*)::bigint                                                       AS n_runs,
    round(avg(r.faithfulness_score)::numeric, 3)                          AS faithfulness_avg,
    round(avg(r.answer_relevancy_score)::numeric, 3)                      AS answer_relevancy_avg,
    round(avg(r.context_precision_score)::numeric, 3)                     AS context_precision_avg,
    round(avg(r.context_recall_score)::numeric, 3)                        AS context_recall_avg,
    round(avg(r.composite_score)::numeric, 3)                             AS composite_avg,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.faithfulness_score)::numeric, 3) AS faithfulness_p50,
    round(percentile_cont(0.9) WITHIN GROUP (ORDER BY r.faithfulness_score)::numeric, 3) AS faithfulness_p90,
    now() - make_interval(hours => p_period_hours)                        AS period_start,
    now()                                                                  AS period_end
  FROM public.rag_eval_runs r
  WHERE r.created_at >= now() - make_interval(hours => p_period_hours)
    AND (p_profile_slug    IS NULL OR r.context_profile_slug = p_profile_slug)
    AND (p_embedding_model IS NULL OR r.embedding_model      = p_embedding_model)
  GROUP BY r.context_profile_slug, r.embedding_model, r.llm_model
  ORDER BY n_runs DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_rag_baseline(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_rag_baseline(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_rag_baseline(text, text, integer) TO service_role;

COMMENT ON FUNCTION public.fn_get_rag_baseline(text, text, integer) IS
  'Aggregated retrieval-quality metrics for last N hours. Used by admin observability tile and regression gates.';
