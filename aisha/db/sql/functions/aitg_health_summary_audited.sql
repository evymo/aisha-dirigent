-- Function: aitg_health_summary_audited

CREATE OR REPLACE FUNCTION public.aitg_health_summary_audited(p_window_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean;
  v_summary jsonb;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  WITH agg AS (
    SELECT
      COUNT(*) FILTER (WHERE r.status = 'passed')::int AS passed,
      COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed,
      COUNT(*)::int AS total
    FROM public.aitg_runs r
    WHERE r.finished_at >= now() - (p_window_hours || ' hours')::interval
  ),
  trust AS (
    SELECT trust_score, weighted_total, weighted_passed, measured_tests, failing_tests, window_days FROM public.aitg_get_trust_score_audited(
      GREATEST(1, (p_window_hours / 24)::int)
    ) LIMIT 1
  ),
  open_findings AS (
    SELECT COUNT(*)::int AS c FROM public.aitg_findings WHERE fixed_at IS NULL
  ),
  drift AS (
    SELECT COUNT(*)::int AS c FROM public.aitg_drift_alerts
    WHERE resolved_at IS NULL AND created_at >= now() - (p_window_hours || ' hours')::interval
  ),
  last_refl AS (
    SELECT reflection_date, trust_score_snapshot, summary
    FROM public.aitg_aisha_reflections
    ORDER BY reflection_date DESC LIMIT 1
  )
  SELECT jsonb_build_object(
    'window_hours', p_window_hours,
    'total_runs', COALESCE((SELECT total FROM agg), 0),
    'passed_runs', COALESCE((SELECT passed FROM agg), 0),
    'failed_runs', COALESCE((SELECT failed FROM agg), 0),
    'trust_score', (SELECT trust_score FROM trust),
    'open_findings', (SELECT c FROM open_findings),
    'open_drift_alerts', (SELECT c FROM drift),
    'last_reflection', (SELECT jsonb_build_object(
        'date', reflection_date,
        'trust_score', trust_score_snapshot,
        'summary', summary) FROM last_refl)
  ) INTO v_summary;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.health_summary_read', 'aitg.health_summary_read',
          'security', 'info', ARRAY['aitg','health'], v_summary);

  RETURN v_summary;
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_health_summary_audited(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_health_summary_audited(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_health_summary_audited(integer) TO service_role;
