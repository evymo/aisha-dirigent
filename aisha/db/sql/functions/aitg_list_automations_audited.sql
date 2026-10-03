-- Function: aitg_list_automations_audited

CREATE OR REPLACE FUNCTION public.aitg_list_automations_audited()
 RETURNS SETOF aitg_automation_settings
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
  VALUES (auth.uid(), 'aitg.automations_listed', 'aitg.automations_listed',
          'security', 'info', ARRAY['aitg','automation','read'], '{}'::jsonb);

  RETURN QUERY SELECT automation_id, display_name, description, mode, schedule_cron, schedule_interval_minutes, parameters, workflow_id, last_run_at, last_run_status, last_run_details, updated_at, updated_by, created_at FROM public.aitg_automation_settings
  ORDER BY automation_id;
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_list_automations_audited() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_list_automations_audited() TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_list_automations_audited() TO service_role;
