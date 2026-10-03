-- Function: aitg_record_reflection_audited

CREATE OR REPLACE FUNCTION public.aitg_record_reflection_audited(p_summary text, p_proposed_actions jsonb DEFAULT '[]'::jsonb, p_generated_by text DEFAULT 'aisha'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean;
  v_id uuid;
  v_today date := current_date;
  v_trust numeric;
  v_prev_trust numeric;
  v_total int;
  v_failed int;
  v_open int;
  v_new_failures int;
  v_newly_fixed int;
  v_drifts int;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF length(p_summary) < 10 THEN
    RAISE EXCEPTION 'AITG_REFLECTION_SUMMARY_TOO_SHORT' USING ERRCODE = '22023';
  END IF;

  SELECT trust_score INTO v_trust FROM public.aitg_get_trust_score_audited(1) LIMIT 1;
  SELECT trust_score_snapshot INTO v_prev_trust
  FROM public.aitg_aisha_reflections
  WHERE generated_by = p_generated_by AND reflection_date < v_today
  ORDER BY reflection_date DESC LIMIT 1;

  SELECT
    COUNT(*) FILTER (WHERE r.finished_at >= now() - interval '24 hours')::int,
    COUNT(*) FILTER (WHERE r.status = 'failed' AND r.finished_at >= now() - interval '24 hours')::int
  INTO v_total, v_failed
  FROM public.aitg_runs r;

  SELECT COUNT(*)::int INTO v_open FROM public.aitg_findings WHERE fixed_at IS NULL;
  SELECT COUNT(*)::int INTO v_new_failures
    FROM public.aitg_findings WHERE fixed_at IS NULL
      AND finding_id IN (
        SELECT f.finding_id FROM public.aitg_findings f
        JOIN public.aitg_runs r ON r.run_id = f.run_id
        WHERE r.finished_at >= now() - interval '24 hours'
      );
  SELECT COUNT(*)::int INTO v_newly_fixed FROM public.aitg_findings
    WHERE fixed_at >= now() - interval '24 hours';
  SELECT COUNT(*)::int INTO v_drifts FROM public.aitg_drift_alerts
    WHERE resolved_at IS NULL AND created_at >= now() - interval '24 hours';

  INSERT INTO public.aitg_aisha_reflections (
    reflection_date, trust_score_snapshot, trust_score_delta,
    total_runs_window, failed_runs_window, open_findings_count,
    new_failures_count, newly_fixed_count, drift_alerts_count,
    summary, proposed_actions, generated_by
  ) VALUES (
    v_today, COALESCE(v_trust, 0), v_trust - v_prev_trust,
    v_total, v_failed, v_open,
    v_new_failures, v_newly_fixed, v_drifts,
    p_summary, p_proposed_actions, p_generated_by
  )
  ON CONFLICT (reflection_date, generated_by) DO UPDATE SET
    summary = EXCLUDED.summary,
    proposed_actions = EXCLUDED.proposed_actions,
    trust_score_snapshot = EXCLUDED.trust_score_snapshot,
    trust_score_delta = EXCLUDED.trust_score_delta
  RETURNING reflection_id INTO v_id;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.reflection_recorded', 'aitg.reflection_recorded', 'security', 'info',
          ARRAY['aitg','reflection', p_generated_by],
          jsonb_build_object('reflection_id', v_id, 'trust_score', v_trust,
                              'delta', v_trust - v_prev_trust, 'open_findings', v_open));

  RETURN v_id;
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_record_reflection_audited(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_record_reflection_audited(text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_record_reflection_audited(text,jsonb,text) TO service_role;
