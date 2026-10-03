-- Function: finish_ai_run
-- Finalizes an ai_runs row: sets terminal status + aggregates cost.
--
-- Cost contract (canonical): cost_total_json = { total, tokens_input,
-- tokens_output, total_duration_ms, event_count }. Two runtime cost paths feed it:
--   - tracer path (insert_ai_trace_event) → per-event cost_json {usd, tokens_in,
--     tokens_out}; aggregated here.
--   - reflection path (appendCost) → live-accumulated cost_total_json on the row.
-- This function PREFERS the event-sourced aggregate but FALLS BACK to the
-- live-accumulated value, so a reflection run (no trace events) is preserved
-- rather than clobbered. The reader (list_active_agent_runs) and the Mission
-- Control board both read cost_total_json->>'total'.

CREATE OR REPLACE FUNCTION public.finish_ai_run(p_run_id uuid, p_status text DEFAULT 'succeeded'::text, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cost     jsonb;
  v_existing jsonb;
BEGIN
  -- Validate status
  IF p_status NOT IN ('succeeded', 'failed', 'canceled', 'blocked') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid run status: %s', p_status), ERRCODE = 'P0001';
  END IF;

  -- Live-accumulated cost (reflection appendCost path) — used as fallback so a
  -- run with no trace events keeps its real cost instead of being zeroed.
  SELECT cost_total_json INTO v_existing FROM ai_runs WHERE id = p_run_id;

  -- Aggregate canonical cost from trace events, falling back to the live value.
  SELECT jsonb_build_object(
    'total', COALESCE(
                   NULLIF(SUM(COALESCE((ate.cost_json->>'usd')::numeric, 0)), 0),
                   (v_existing->>'total')::numeric,
                   0),
    'tokens_input', COALESCE(
                   NULLIF(SUM(COALESCE((ate.cost_json->>'tokens_in')::int, 0)), 0),
                   (v_existing->>'tokens_input')::int,
                   0),
    'tokens_output', COALESCE(
                   NULLIF(SUM(COALESCE((ate.cost_json->>'tokens_out')::int, 0)), 0),
                   (v_existing->>'tokens_output')::int,
                   0),
    'total_duration_ms', COALESCE(SUM(ate.duration_ms), 0),
    'event_count', COUNT(*)
  )
  INTO v_cost
  FROM ai_trace_events ate
  WHERE ate.run_id = p_run_id;

  UPDATE ai_runs
  SET
    status = p_status,
    finished_at = now(),
    cost_total_json = COALESCE(v_cost, '{}'::jsonb),
    metadata = CASE
      WHEN p_metadata IS NOT NULL THEN ai_runs.metadata || p_metadata
      ELSE ai_runs.metadata
    END
  WHERE id = p_run_id;
END;
$function$;

REVOKE ALL ON FUNCTION finish_ai_run(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finish_ai_run(uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION finish_ai_run(uuid,text,jsonb) TO service_role;
