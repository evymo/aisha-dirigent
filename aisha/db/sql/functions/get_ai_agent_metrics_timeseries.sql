-- Function: public.get_ai_agent_metrics_timeseries
-- Arguments: p_hours_back integer DEFAULT 168, p_agent_slug text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_ai_agent_metrics_timeseries(p_hours_back integer DEFAULT 168, p_agent_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.hour), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      hour,
      agent_slug,
      SUM(total_events)::int AS total_events,
      AVG(avg_latency_ms)::int AS avg_latency_ms,
      SUM(total_tokens)::bigint AS total_tokens,
      SUM(total_cost)::numeric(12,4) AS total_cost,
      SUM(errors)::int AS errors,
      SUM(successes)::int AS successes
    FROM ai_agent_metrics_hourly
    WHERE hour >= now() - (p_hours_back || ' hours')::interval
      AND (p_agent_slug IS NULL OR agent_slug = p_agent_slug)
    GROUP BY hour, agent_slug
    ORDER BY hour
  ) t;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_ai_agent_metrics_timeseries(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_agent_metrics_timeseries(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_agent_metrics_timeseries(integer, text) TO service_role;
