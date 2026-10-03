-- ============================================================================
-- Source of Truth: fn_detect_rag_baseline_regression
-- Phase 12 WP 1.6 — RAGAS nightly regression detection
--
-- Compares the most-recent rag_eval_baselines row against the 7-day moving
-- average (excluding the latest row itself), per (context_profile_slug,
-- embedding_model, llm_model). Returns one row per group flagged with a
-- severity verdict:
--
--   ok       composite_avg drop < 0.02 OR drop ratio < 2.5 %
--   warning  composite_avg drop >= 0.02 OR drop ratio >= 2.5 %
--   critical composite_avg drop >= 0.05 OR drop ratio >= 5 % (per plan SLO)
--
-- Verdict thresholds are config-driven (p_warn_drop, p_crit_drop) so the
-- operator can tune without redeploying the RPC.
--
-- Consumed by WF_RAG_EVAL_NIGHTLY n8n workflow — emits Matrix alert when
-- ANY group hits 'critical', and ops-channel summary when any group hits
-- 'warning'.
--
-- Bezpečnost: SECURITY DEFINER, GRANT EXECUTE TO service_role only.
-- Audit:      INSERT INTO audit_journal on critical verdicts only (low
--             cardinality — warnings are too frequent for audit trail).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_detect_rag_baseline_regression(
  p_lookback_hours integer DEFAULT 168,         -- 7 days
  p_warn_drop      numeric DEFAULT 0.02,        -- composite_avg point drop
  p_crit_drop      numeric DEFAULT 0.05,        -- per plan SLO
  p_warn_pct       numeric DEFAULT 0.025,       -- 2.5 % relative drop
  p_crit_pct       numeric DEFAULT 0.05         -- 5 % relative drop
)
RETURNS TABLE (
  context_profile_slug   text,
  embedding_model        text,
  llm_model              text,
  latest_period_end      timestamptz,
  latest_composite       numeric,
  lookback_avg_composite numeric,
  drop_absolute          numeric,
  drop_pct               numeric,
  severity               text,
  reason                 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  -- Service-role only — this is invoked from n8n nightly workflow and
  -- from the rag-eval service after batch completion.
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF p_lookback_hours <= 0 THEN
    RAISE EXCEPTION 'p_lookback_hours must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_warn_drop < 0 OR p_crit_drop < 0 THEN
    RAISE EXCEPTION 'drop thresholds must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_crit_drop < p_warn_drop THEN
    RAISE EXCEPTION 'p_crit_drop (%) must be >= p_warn_drop (%)',
      p_crit_drop, p_warn_drop USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    -- Per group, identify the newest baseline + numbered older rows so we
    -- can compute "moving average excluding latest" without double-counting.
    SELECT
      b.context_profile_slug,
      b.embedding_model,
      b.llm_model,
      b.period_end,
      b.composite_avg,
      row_number() OVER (
        PARTITION BY b.context_profile_slug, b.embedding_model, b.llm_model
        ORDER BY b.period_end DESC
      ) AS rn
    FROM public.rag_eval_baselines b
    WHERE b.period_end >= (now() - make_interval(hours => p_lookback_hours))
      AND b.composite_avg IS NOT NULL
  ),
  latest AS (
    SELECT
      r.context_profile_slug,
      r.embedding_model,
      r.llm_model,
      r.period_end       AS latest_period_end,
      r.composite_avg    AS latest_composite
    FROM ranked r
    WHERE r.rn = 1
  ),
  lookback AS (
    SELECT
      r.context_profile_slug,
      r.embedding_model,
      r.llm_model,
      round(avg(r.composite_avg)::numeric, 3) AS lookback_avg_composite,
      count(*)::integer                       AS lookback_n
    FROM ranked r
    WHERE r.rn > 1
    GROUP BY r.context_profile_slug, r.embedding_model, r.llm_model
  )
  SELECT
    l.context_profile_slug,
    l.embedding_model,
    l.llm_model,
    l.latest_period_end,
    l.latest_composite,
    lb.lookback_avg_composite,
    round((lb.lookback_avg_composite - l.latest_composite)::numeric, 3) AS drop_absolute,
    round(
      CASE
        WHEN lb.lookback_avg_composite IS NULL OR lb.lookback_avg_composite = 0 THEN 0
        ELSE ((lb.lookback_avg_composite - l.latest_composite) / lb.lookback_avg_composite)::numeric
      END,
      4
    ) AS drop_pct,
    CASE
      -- Insufficient history: surface 'ok' with reason — alert as info
      WHEN lb.lookback_avg_composite IS NULL OR lb.lookback_n < 2 THEN 'ok'
      WHEN (lb.lookback_avg_composite - l.latest_composite) >= p_crit_drop
        OR ((lb.lookback_avg_composite - l.latest_composite) / NULLIF(lb.lookback_avg_composite, 0)) >= p_crit_pct
      THEN 'critical'
      WHEN (lb.lookback_avg_composite - l.latest_composite) >= p_warn_drop
        OR ((lb.lookback_avg_composite - l.latest_composite) / NULLIF(lb.lookback_avg_composite, 0)) >= p_warn_pct
      THEN 'warning'
      ELSE 'ok'
    END AS severity,
    CASE
      WHEN lb.lookback_avg_composite IS NULL OR lb.lookback_n < 2 THEN
        'insufficient_history_n=' || COALESCE(lb.lookback_n, 0)::text
      WHEN (lb.lookback_avg_composite - l.latest_composite) >= p_crit_drop THEN
        'composite_drop_abs >= ' || p_crit_drop::text
      WHEN ((lb.lookback_avg_composite - l.latest_composite) / NULLIF(lb.lookback_avg_composite, 0)) >= p_crit_pct THEN
        'composite_drop_pct >= ' || p_crit_pct::text
      WHEN (lb.lookback_avg_composite - l.latest_composite) >= p_warn_drop THEN
        'composite_drop_abs >= ' || p_warn_drop::text
      WHEN ((lb.lookback_avg_composite - l.latest_composite) / NULLIF(lb.lookback_avg_composite, 0)) >= p_warn_pct THEN
        'composite_drop_pct >= ' || p_warn_pct::text
      ELSE 'within_tolerance'
    END AS reason
  FROM latest l
  LEFT JOIN lookback lb USING (context_profile_slug, embedding_model, llm_model)
  ORDER BY
    CASE WHEN (lb.lookback_avg_composite - l.latest_composite) >= p_crit_drop THEN 0
         WHEN (lb.lookback_avg_composite - l.latest_composite) >= p_warn_drop THEN 1
         ELSE 2 END,
    l.context_profile_slug NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_rag_baseline_regression(integer, numeric, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_detect_rag_baseline_regression(integer, numeric, numeric, numeric, numeric) TO service_role;

COMMENT ON FUNCTION public.fn_detect_rag_baseline_regression(integer, numeric, numeric, numeric, numeric) IS
  'Phase 12 WP 1.6 — per-group regression detector. Compares latest rag_eval_baselines row against the 7-day MA (default), returns severity {ok,warning,critical} verdict. Service-role only.';
