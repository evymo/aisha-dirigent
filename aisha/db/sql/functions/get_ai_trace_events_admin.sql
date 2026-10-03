-- Function: public.get_ai_trace_events_admin
-- Arguments: p_run_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_ai_trace_events_admin(p_run_id uuid)
 RETURNS TABLE(id uuid, run_id uuid, event_type text, operation text, agent_slug text, provider text, status text, duration_ms integer, cost_json jsonb, request_summary jsonb, response_summary jsonb, error_json jsonb, created_at timestamptz, backend_kind text, model_id text, decision_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    ate.id, ate.run_id, ate.event_type::text, ate.operation,
    ate.agent_slug, ate.provider, ate.status,
    ate.duration_ms, ate.cost_json,
    ate.request_summary, ate.response_summary, ate.error_json,
    ate.created_at,
    -- The runtime/executor axis (decision_id → ai_decisions.runtime) — operators
    -- must see WHICH runtime executed, not just the provider (cloud axis).
    ate.backend_kind, ate.model_id, ate.decision_id
  FROM ai_trace_events ate
  WHERE ate.run_id = p_run_id
  ORDER BY ate.created_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_ai_trace_events_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_trace_events_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_trace_events_admin(uuid) TO service_role;
