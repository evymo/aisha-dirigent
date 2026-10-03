-- Function: aitg_detect_drift_audited

CREATE OR REPLACE FUNCTION public.aitg_detect_drift_audited(p_window_hours integer DEFAULT 24, p_min_runs integer DEFAULT 5, p_drop_threshold_pp numeric DEFAULT 0.10)
 RETURNS SETOF aitg_drift_alerts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean;
  v_test record;
  v_cur numeric;
  v_prev numeric;
  v_alert_id uuid;
  v_severity aitg_severity;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  FOR v_test IN
    SELECT test_id FROM public.aitg_test_catalog WHERE enabled
  LOOP
    -- current window
    SELECT
      CASE WHEN COUNT(*) >= p_min_runs
           THEN COUNT(*) FILTER (WHERE status = 'passed')::numeric / COUNT(*)
           ELSE NULL END
    INTO v_cur
    FROM public.aitg_runs
    WHERE test_id = v_test.test_id
      AND finished_at >= now() - (p_window_hours || ' hours')::interval;

    -- previous (same-length window, just before)
    SELECT
      CASE WHEN COUNT(*) >= p_min_runs
           THEN COUNT(*) FILTER (WHERE status = 'passed')::numeric / COUNT(*)
           ELSE NULL END
    INTO v_prev
    FROM public.aitg_runs
    WHERE test_id = v_test.test_id
      AND finished_at >= now() - (p_window_hours * 2 || ' hours')::interval
      AND finished_at <  now() - (p_window_hours     || ' hours')::interval;

    IF v_cur IS NULL OR v_prev IS NULL THEN CONTINUE; END IF;
    IF (v_prev - v_cur) < p_drop_threshold_pp THEN CONTINUE; END IF;

    -- severity scales with magnitude of drop
    v_severity := CASE
      WHEN (v_prev - v_cur) >= 0.30 THEN 'critical'
      WHEN (v_prev - v_cur) >= 0.20 THEN 'high'
      WHEN (v_prev - v_cur) >= 0.10 THEN 'medium'
      ELSE 'low'
    END;

    INSERT INTO public.aitg_drift_alerts (
      test_id, window_label, current_pass_rate, previous_pass_rate, delta, severity, details
    ) VALUES (
      v_test.test_id, p_window_hours || 'h', v_cur, v_prev, v_cur - v_prev, v_severity,
      jsonb_build_object('detected_at', now(), 'min_runs', p_min_runs)
    ) RETURNING alert_id INTO v_alert_id;

    INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
    VALUES (auth.uid(), 'aitg.drift_detected', 'aitg.drift_detected', 'security',
            CASE v_severity WHEN 'critical' THEN 'error' WHEN 'high' THEN 'warn' ELSE 'info' END,
            ARRAY['aitg','drift', v_test.test_id],
            jsonb_build_object('alert_id', v_alert_id, 'test_id', v_test.test_id,
                               'delta', v_cur - v_prev, 'severity', v_severity));
  END LOOP;

  RETURN QUERY SELECT alert_id, test_id, window_label, current_pass_rate, previous_pass_rate, delta, severity, acknowledged_at, acknowledged_by, resolved_at, details, created_at FROM public.aitg_drift_alerts
    WHERE resolved_at IS NULL AND created_at >= now() - interval '1 hour'
    ORDER BY severity DESC, created_at DESC;
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_detect_drift_audited(integer,integer,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_detect_drift_audited(integer,integer,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_detect_drift_audited(integer,integer,numeric) TO service_role;
