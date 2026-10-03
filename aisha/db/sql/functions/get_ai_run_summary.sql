-- Function: public.get_ai_run_summary
-- Arguments: p_hours_back integer DEFAULT 168
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_ai_run_summary(p_hours_back integer DEFAULT 168)
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

  SELECT jsonb_build_object(
    'total_runs', totals.total_runs,
    'by_status', totals.by_status,
    'by_kind', totals.by_kind,
    'avg_duration_ms', totals.avg_duration
  )
  INTO v_result
  FROM (
    SELECT
      COUNT(*) AS total_runs,
      AVG(
        CASE WHEN finished_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000
        ELSE NULL END
      )::int AS avg_duration,
      COALESCE(
        (SELECT jsonb_object_agg(s.status, s.cnt) FROM (
          SELECT status, COUNT(*) AS cnt
          FROM ai_runs
          WHERE started_at >= now() - (p_hours_back || ' hours')::interval
          GROUP BY status
        ) s),
        '{}'::jsonb
      ) AS by_status,
      COALESCE(
        (SELECT jsonb_object_agg(k.kind, k.cnt) FROM (
          SELECT kind, COUNT(*) AS cnt
          FROM ai_runs
          WHERE started_at >= now() - (p_hours_back || ' hours')::interval
          GROUP BY kind
        ) k),
        '{}'::jsonb
      ) AS by_kind
    FROM ai_runs
    WHERE started_at >= now() - (p_hours_back || ' hours')::interval
  ) totals;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_ai_run_summary(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_run_summary(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_run_summary(integer) TO service_role;
