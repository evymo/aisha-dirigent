-- Function: aitg_record_automation_run_audited

CREATE OR REPLACE FUNCTION public.aitg_record_automation_run_audited(p_automation_id text, p_status text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS void
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
  IF p_status NOT IN ('success','failed','skipped','running') THEN
    RAISE EXCEPTION 'AITG_INVALID_STATUS' USING ERRCODE = '22023';
  END IF;

  UPDATE public.aitg_automation_settings
  SET last_run_at = now(),
      last_run_status = p_status,
      last_run_details = p_details
  WHERE automation_id = p_automation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AITG_AUTOMATION_NOT_FOUND' USING ERRCODE = '02000';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.automation_run_recorded', 'aitg.automation_run_recorded',
          'security',
          CASE p_status WHEN 'failed' THEN 'warn' WHEN 'skipped' THEN 'info' ELSE 'info' END,
          ARRAY['aitg','automation','run', p_automation_id, p_status],
          jsonb_build_object('automation_id', p_automation_id, 'status', p_status));
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_record_automation_run_audited(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_record_automation_run_audited(text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_record_automation_run_audited(text,text,jsonb) TO service_role;
