-- Function: aitg_trigger_automation_audited

CREATE OR REPLACE FUNCTION public.aitg_trigger_automation_audited(p_automation_id text, p_initiator text DEFAULT 'operator'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.aitg_automation_settings;
  v_trigger_id uuid := gen_random_uuid();
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.aitg_automation_settings WHERE automation_id = p_automation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AITG_AUTOMATION_NOT_FOUND' USING ERRCODE = '02000';
  END IF;
  IF v_row.mode = 'disabled' THEN
    RAISE EXCEPTION 'AITG_AUTOMATION_DISABLED' USING ERRCODE = '22023';
  END IF;

  -- Record running status; the workflow webhook is responsible for the
  -- actual execution (via aitg_record_automation_run_audited on completion).
  UPDATE public.aitg_automation_settings
  SET last_run_at = now(),
      last_run_status = 'running',
      last_run_details = jsonb_build_object('trigger_id', v_trigger_id, 'initiator', p_initiator,
                                             'requested_at', now())
  WHERE automation_id = p_automation_id;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.automation_triggered', 'aitg.automation_triggered',
          'security', 'info', ARRAY['aitg','automation','trigger', p_automation_id],
          jsonb_build_object('automation_id', p_automation_id, 'trigger_id', v_trigger_id,
                              'initiator', p_initiator, 'mode_at_trigger', v_row.mode,
                              'workflow_id', v_row.workflow_id));

  RETURN v_trigger_id;
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_trigger_automation_audited(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_trigger_automation_audited(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_trigger_automation_audited(text,text) TO service_role;
