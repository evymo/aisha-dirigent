-- ============================================================================
-- Source of Truth: fn_compute_rag_baseline_audited
-- Popis: Recompute aggregated rows in public.rag_eval_baselines for the last
--        N hours. Called by:
--          - services/svc-mcp-knowledge/src/routes/rag-eval.ts (after each batch)
--          - WF_RAG_EVAL_NIGHTLY (n8n cron) via the same endpoint
--
-- Step:   Step 0 of retrieval optimization plan 2026
-- Bezpečnost: SECURITY DEFINER + service_role only
-- Audit:  INSERT INTO audit_journal (action='rag_eval.baseline_recomputed', metadata)
-- Source migration: aisha/db/migrations/20260518200000_rag_eval_foundation.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_compute_rag_baseline_audited(
  p_period_hours integer DEFAULT 24
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows_inserted integer := 0;
  v_period_start  timestamptz;
  v_period_end    timestamptz;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  v_period_end   := date_trunc('hour', now());
  v_period_start := v_period_end - make_interval(hours => p_period_hours);

  WITH agg AS (
    SELECT
      r.context_profile_slug,
      r.embedding_model,
      r.llm_model,
      count(*)::integer                          AS n_runs,
      round(avg(r.faithfulness_score)::numeric,        3) AS faithfulness_avg,
      round(avg(r.answer_relevancy_score)::numeric,    3) AS answer_relevancy_avg,
      round(avg(r.context_precision_score)::numeric,   3) AS context_precision_avg,
      round(avg(r.context_recall_score)::numeric,      3) AS context_recall_avg,
      round(avg(r.composite_score)::numeric,           3) AS composite_avg,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.faithfulness_score)::numeric, 3) AS faithfulness_p50,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY r.faithfulness_score)::numeric, 3) AS faithfulness_p90
    FROM public.rag_eval_runs r
    WHERE r.created_at >= v_period_start
      AND r.created_at <  v_period_end
    GROUP BY r.context_profile_slug, r.embedding_model, r.llm_model
  )
  INSERT INTO public.rag_eval_baselines (
    period_start, period_end, context_profile_slug, embedding_model, llm_model,
    n_runs, faithfulness_avg, answer_relevancy_avg, context_precision_avg,
    context_recall_avg, composite_avg, faithfulness_p50, faithfulness_p90
  )
  SELECT
    v_period_start, v_period_end, agg.context_profile_slug, agg.embedding_model, agg.llm_model,
    agg.n_runs, agg.faithfulness_avg, agg.answer_relevancy_avg, agg.context_precision_avg,
    agg.context_recall_avg, agg.composite_avg, agg.faithfulness_p50, agg.faithfulness_p90
  FROM agg
  ON CONFLICT (period_start, period_end, context_profile_slug, embedding_model, llm_model)
  DO UPDATE SET
    n_runs                = EXCLUDED.n_runs,
    faithfulness_avg      = EXCLUDED.faithfulness_avg,
    answer_relevancy_avg  = EXCLUDED.answer_relevancy_avg,
    context_precision_avg = EXCLUDED.context_precision_avg,
    context_recall_avg    = EXCLUDED.context_recall_avg,
    composite_avg         = EXCLUDED.composite_avg,
    faithfulness_p50      = EXCLUDED.faithfulness_p50,
    faithfulness_p90      = EXCLUDED.faithfulness_p90;

  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'rag_eval.baseline_recomputed',
    jsonb_build_object(
      'period_start', v_period_start,
      'period_end',   v_period_end,
      'period_hours', p_period_hours,
      'rows_upserted', v_rows_inserted
    )
  );

  RETURN v_rows_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_compute_rag_baseline_audited(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compute_rag_baseline_audited(integer) TO service_role;

COMMENT ON FUNCTION public.fn_compute_rag_baseline_audited(integer) IS
  'Recompute rag_eval_baselines for last N hours. Called by WF_RAG_EVAL_NIGHTLY after batch. Service-role only.';
