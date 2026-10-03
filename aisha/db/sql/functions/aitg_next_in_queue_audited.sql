-- Function: aitg_next_in_queue_audited

CREATE OR REPLACE FUNCTION public.aitg_next_in_queue_audited(p_limit integer DEFAULT 5)
 RETURNS TABLE(test_id text, priority numeric, rationale text, last_run timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.queue_peeked', 'aitg.queue_peeked', 'security', 'info',
          ARRAY['aitg','queue','read'], jsonb_build_object('limit', p_limit));

  RETURN QUERY
  WITH per_test AS (
    SELECT
      c.test_id,
      c.severity_weight,
      MAX(r.finished_at) AS last_run,
      COUNT(*) FILTER (WHERE r.status = 'failed'
                         AND r.finished_at >= now() - interval '24 hours')::numeric AS recent_failures,
      COUNT(*) FILTER (WHERE da.resolved_at IS NULL)::numeric AS open_drifts
    FROM public.aitg_test_catalog c
    LEFT JOIN public.aitg_runs r ON r.test_id = c.test_id
    LEFT JOIN public.aitg_drift_alerts da ON da.test_id = c.test_id AND da.resolved_at IS NULL
    WHERE c.enabled
    GROUP BY c.test_id, c.severity_weight
  )
  SELECT
    pt.test_id,
    -- staleness × severity + recent failures + drifts
    ROUND(
      (COALESCE(EXTRACT(EPOCH FROM (now() - pt.last_run)) / 3600.0, 168.0) / 24.0) * pt.severity_weight
      + pt.recent_failures * 2.0
      + pt.open_drifts * 3.0,
      3
    ) AS priority,
    (CASE WHEN pt.last_run IS NULL THEN 'never_run'
          WHEN pt.recent_failures > 0 THEN 'recent_failures=' || pt.recent_failures
          WHEN pt.open_drifts > 0 THEN 'open_drifts=' || pt.open_drifts
          ELSE 'staleness' END) AS rationale,
    pt.last_run
  FROM per_test pt
  ORDER BY priority DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_next_in_queue_audited(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_next_in_queue_audited(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_next_in_queue_audited(integer) TO service_role;
