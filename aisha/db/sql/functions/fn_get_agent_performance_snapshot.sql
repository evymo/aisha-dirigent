-- Function: fn_get_agent_performance_snapshot
-- Snímek výkonu agenta AISHY podle slugu: kvalita z hodnocení (eval) a provoz z trace
-- (chybovost, latence, náklad) za časové okno.
--
-- Oprava 2026-09-28 (SELF_IMPROVEMENT_LOOP.md §3, K-01) — naměřeno na main 9087ef3df:
--   1. Kvalita se spojovala `JOIN ai_runs r ON r.id = er.run_id`, ale `ai_eval_runs`
--      sloupec `run_id` NEMÁ → každé volání padlo („column er.run_id does not exist").
--      WF_IMPROVEMENT_EVAL i WF_MODEL_ADVISORY tak nikdy nedostaly snímek.
--      Agent se k hodnocení váže přes existující vazbu: ai_eval_results.golden_example_id
--      → ai_golden_examples.agent_slug (jediný nosič „tahle odpověď patří agentovi X").
--   2. Neměřená kvalita/chybovost se vracela jako 0 (COALESCE). WF_IMPROVEMENT_EVAL pak
--      četl „kvalita po změně = 0" jako regresi a navrhl rollback dobré změny. Teď:
--      null = neměřeno, nikdy nula (ONE_WORLD_MODEL Z3); `eval_measured` to říká výslovně.
--   3. `total_events` čte WF_MODEL_ADVISORY na nejvyšší úrovni, funkce ho vracela jen
--      zanořený v `trace_metrics` → poradce viděl vždy 0 < 50 a nikdy nic nenavrhl.
--      Klíč je nově i nahoře (vnořený tvar zůstává kvůli kompatibilitě).
--   4. SECURITY DEFINER s grantem `authenticated` bez vlastní autorizace = orákulum
--      výkonu libovolného agenta pro každého přihlášeného. Volají ho jen n8n (služba)
--      a správa → stráž service_role / admin_or_staff.
-- Klíč nákladu `cost_json->>'usd'` zůstává — kanonizace tvaru je samostatný krok (K-07).

CREATE OR REPLACE FUNCTION public.fn_get_agent_performance_snapshot(
  p_agent_slug text,
  p_hours_window integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cutoff        timestamptz;
  v_eval_metrics  jsonb;
  v_trace_metrics jsonb;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM agent_catalog WHERE slug = p_agent_slug) THEN
    RETURN jsonb_build_object('error', 'Agent not found: ' || p_agent_slug);
  END IF;

  IF p_hours_window IS NULL OR p_hours_window <= 0 THEN
    RAISE EXCEPTION 'p_hours_window must be a positive number of hours' USING ERRCODE = '22023';
  END IF;

  v_cutoff := now() - make_interval(hours => p_hours_window);

  -- Kvalita: výsledky dokončených hodnocení, jejichž zlatý příklad patří agentovi.
  SELECT jsonb_build_object(
    'avg_coherence',    round(avg(res.coherence_score), 4),
    'avg_groundedness', round(avg(res.groundedness_score), 4),
    'avg_overall',      round(avg(res.overall_score), 4),
    'avg_relevance',    round(avg(res.relevance_score), 4),
    'avg_safety',       round(avg(res.safety_score), 4),
    'eval_count',       count(DISTINCT er.id),
    'result_count',     count(*)
  )
  INTO v_eval_metrics
  FROM ai_eval_results res
  JOIN ai_eval_runs er       ON er.id = res.eval_run_id
  JOIN ai_golden_examples ge ON ge.id = res.golden_example_id
  WHERE ge.agent_slug = p_agent_slug
    AND er.status = 'completed'
    AND er.completed_at >= v_cutoff;

  -- Provoz
  SELECT jsonb_build_object(
    'avg_duration_ms', round(avg(te.duration_ms), 0),
    'error_count',     count(*) FILTER (WHERE te.status = 'error'),
    'error_rate',      CASE
                         WHEN count(*) > 0
                           THEN round(count(*) FILTER (WHERE te.status = 'error')::numeric / count(*)::numeric, 4)
                         ELSE NULL
                       END,
    'total_cost',      round(sum((te.cost_json->>'usd')::numeric), 4),
    'total_events',    count(*)
  )
  INTO v_trace_metrics
  FROM ai_trace_events te
  WHERE te.agent_slug = p_agent_slug
    AND te.created_at >= v_cutoff;

  RETURN jsonb_build_object(
    'agent_slug',     p_agent_slug,
    'avg_overall',    (v_eval_metrics->>'avg_overall')::numeric,            -- null = neměřeno
    'eval_measured',  COALESCE((v_eval_metrics->>'result_count')::int, 0) > 0,
    'error_rate',     (v_trace_metrics->>'error_rate')::numeric,             -- null = žádná událost
    'total_events',   COALESCE((v_trace_metrics->>'total_events')::int, 0),
    'eval_metrics',   COALESCE(v_eval_metrics, '{}'::jsonb),
    'measured_at',    now(),
    'trace_metrics',  COALESCE(v_trace_metrics, '{}'::jsonb),
    'window_hours',   p_hours_window
  );
END;
$$;

COMMENT ON FUNCTION public.fn_get_agent_performance_snapshot(text, integer) IS
  'Snímek výkonu agenta: kvalita z hodnocení (přes ai_golden_examples.agent_slug) a provoz '
  'z ai_trace_events za okno. null = neměřeno (nikdy 0). Jen služba a správa.';

REVOKE ALL ON FUNCTION public.fn_get_agent_performance_snapshot(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_agent_performance_snapshot(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_agent_performance_snapshot(text, integer) TO service_role;
