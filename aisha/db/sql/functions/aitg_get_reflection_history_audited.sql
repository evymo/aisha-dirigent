-- Function: aitg_get_reflection_history_audited

CREATE OR REPLACE FUNCTION public.aitg_get_reflection_history_audited(p_limit integer DEFAULT 30, p_generated_by text DEFAULT 'aisha'::text)
 RETURNS SETOF aitg_aisha_reflections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.reflection_history_read', 'aitg.reflection_history_read',
          'security', 'info', ARRAY['aitg','reflection','read'],
          jsonb_build_object('limit', p_limit, 'generated_by', p_generated_by));

  RETURN QUERY
  SELECT reflection_id, reflection_date, trust_score_snapshot, trust_score_delta, total_runs_window, failed_runs_window, open_findings_count, new_failures_count, newly_fixed_count, drift_alerts_count, summary, proposed_actions, generated_by, created_at FROM public.aitg_aisha_reflections
  WHERE generated_by = p_generated_by
  ORDER BY reflection_date DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_get_reflection_history_audited(integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_get_reflection_history_audited(integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_get_reflection_history_audited(integer,text) TO service_role;
