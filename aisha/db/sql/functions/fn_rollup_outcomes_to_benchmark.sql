-- Function: public.fn_rollup_outcomes_to_benchmark  (L1 — reactive outcome rollup)
--
-- NAME NOTE: the historical name is retained (the SoT reconcile expects it), but this function
-- writes the ADVISORY reliability sink public.ai_model_reliability via record_model_reliability.
-- It deliberately does NOT write the resolver-ranked quality table: that table is LEFT JOINed by
-- aisha_resolve_clow_backend with no dedup, so a second row there would fan out the candidate set
-- and leak telemetry into the quality score (the curated REPLACE writer documents this very hazard).
-- Reactive telemetry therefore lands only in ai_model_reliability, which nothing in the resolver reads today
-- → zero ranking impact, fully advisory. L2 (advisory proposals) / a future, deliberately-reviewed
-- resolver tie-breaker can consume it explicitly.
--
-- MODEL AXIS = the model's OWN calls only: ai_trace_events restricted to event_type='llm_call'
--   (one per direct_llm dispatch) — tool-call latencies/failures never pollute a model metric.
-- IDENTITY = (provider_slug, model_id): both are join keys, so a model_id served by two providers
--   is never conflated. Decisions without task_kind/provider/model are skipped (no guessing).
-- QUALITY = avg_eval_score is sourced ONLY from a real eval (ai_runs.faithfulness_score_estimate),
--   carried for observability; it is never a ranking input here.
-- task_kind is NORMALIZED (T1 normalize_task_kind) and each kind RECORDED (fn_observe_task_kind).
--
-- Security: SECURITY DEFINER, VOLATILE. EXECUTE restricted to service_role (cron); the NULL-safe
--   body guard also accepts admin/staff. Returns the number of (model × task) reliability rows upserted.
-- Driven by: n8n WF_OUTCOME_ROLLUP (scheduleTrigger ~6h → POST /rpc/fn_rollup_outcomes_to_benchmark).

-- Consolidated under this name; drop the short-lived alias if a prior build created it.
DROP FUNCTION IF EXISTS public.fn_rollup_outcomes_to_reliability(int, int);

CREATE OR REPLACE FUNCTION public.fn_rollup_outcomes_to_benchmark(
  p_window_hours int DEFAULT 168,
  p_min_samples  int DEFAULT 1
)
RETURNS int
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- NULL-safe authorization: an absent claim / unset GUC folds to false, never NULL, so the guard
  -- cannot fail open; a non-service, non-admin caller is rejected.
  v_is_service boolean := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
                          OR COALESCE(current_setting('role', true), '') = 'service_role';
  v_is_admin   boolean := COALESCE(public.is_admin_or_staff(auth.uid()), false);
  v_count      int := 0;
  rec          record;
BEGIN
  IF NOT (v_is_service OR v_is_admin) THEN
    RAISE EXCEPTION 'Not authorized: service_role or admin/staff required' USING ERRCODE = '42501';
  END IF;

  FOR rec IN
    SELECT
      reg.id                                                       AS model_registry_id,
      public.normalize_task_kind(d.decision_json->>'task_kind')    AS task_kind,
      count(*)                                                     AS n,
      avg(t.duration_ms)::int                                      AS avg_latency,
      (percentile_cont(0.95) WITHIN GROUP (ORDER BY t.duration_ms))::int AS p95_latency,
      avg(NULLIF(t.cost_json->>'total', '')::numeric)          AS avg_cost,
      avg((t.status = 'ok')::int)::numeric                         AS success_rate,
      avg((t.status = 'error')::int)::numeric                      AS error_rate,
      avg(r.faithfulness_score_estimate)                           AS avg_eval  -- REAL quality; NULL when no eval ran
    FROM public.ai_decisions d
    JOIN public.ai_trace_events t
      ON t.decision_id = d.id AND t.event_type = 'llm_call'   -- model axis only (no tool_call pollution)
    JOIN public.ai_model_registry reg
      ON reg.model_id = d.model_id AND reg.provider = d.provider_slug  -- (provider, model_id) identity → no conflation
    LEFT JOIN public.ai_runs r ON r.id = d.run_id
    WHERE d.created_at >= now() - make_interval(hours => p_window_hours)
      AND d.model_id IS NOT NULL
      AND d.provider_slug IS NOT NULL
      AND (d.decision_json->>'task_kind') IS NOT NULL
      AND d.runtime = 'direct_llm'
    GROUP BY reg.id, public.normalize_task_kind(d.decision_json->>'task_kind')
    HAVING count(*) >= p_min_samples
  LOOP
    -- Reactive telemetry → ADVISORY reliability sink (REPLACE: one current row per pair).
    -- NEVER the resolver-ranked quality table.
    PERFORM public.record_model_reliability(
      p_model_registry_id => rec.model_registry_id,
      p_task_kind         => rec.task_kind,
      p_sample_count      => rec.n::bigint,
      p_success_rate      => rec.success_rate,
      p_error_rate        => rec.error_rate,
      p_avg_latency_ms    => rec.avg_latency,
      p_p95_latency_ms    => rec.p95_latency,
      p_avg_cost_per_call => rec.avg_cost,
      p_avg_eval_score    => rec.avg_eval,   -- advisory observability only; not read by the resolver
      p_window_hours      => p_window_hours
    );
    -- T1: keep the observed task_kind registry current (descriptive; never gates).
    PERFORM public.fn_observe_task_kind(rec.task_kind, rec.n::bigint);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

COMMENT ON FUNCTION public.fn_rollup_outcomes_to_benchmark(int, int) IS
  'L1 reactive feedback rollup: aggregates REAL production dispatch outcomes (ai_decisions join ai_trace_events on event_type=llm_call, identity provider+model_id) per (model x normalized task_kind) into the ADVISORY ai_model_reliability sink via record_model_reliability; records observed kinds via fn_observe_task_kind. Does NOT write the resolver-ranked quality table (no ranking impact). avg_eval from real eval only. EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.fn_rollup_outcomes_to_benchmark(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_rollup_outcomes_to_benchmark(int, int) TO service_role;
