-- Function: public.get_ai_agent_metrics
-- Arguments: p_hours_back integer DEFAULT 168, p_agent_slug text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_ai_agent_metrics(p_hours_back integer DEFAULT 168, p_agent_slug text DEFAULT NULL::text)
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

  -- Summary per agent
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      agent_slug,
      SUM(total_events)::int AS total_events,
      AVG(avg_latency_ms)::int AS avg_latency_ms,
      MAX(p95_latency_ms) AS p95_latency_ms,
      SUM(total_tokens)::bigint AS total_tokens,
      SUM(total_cost)::numeric(12,4) AS total_cost,
      SUM(errors)::int AS total_errors,
      SUM(successes)::int AS total_successes,
      CASE
        WHEN SUM(total_events) > 0
        THEN ROUND(SUM(errors)::numeric / SUM(total_events) * 100, 2)
        ELSE 0
      END AS error_rate_pct
    FROM ai_agent_metrics_hourly
    WHERE hour >= now() - (p_hours_back || ' hours')::interval
      AND (p_agent_slug IS NULL OR agent_slug = p_agent_slug)
    GROUP BY agent_slug
    ORDER BY SUM(total_events) DESC
  ) t;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_ai_agent_metrics(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_agent_metrics(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_agent_metrics(integer, text) TO service_role;
