-- Function: aitg_get_automation_audited

CREATE OR REPLACE FUNCTION public.aitg_get_automation_audited(p_automation_id text)
 RETURNS aitg_automation_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_is_service boolean; v_row public.aitg_automation_settings;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.automation_read', 'aitg.automation_read', 'security', 'info',
          ARRAY['aitg','automation','read'], jsonb_build_object('automation_id', p_automation_id));

  SELECT * INTO v_row FROM public.aitg_automation_settings WHERE automation_id = p_automation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AITG_AUTOMATION_NOT_FOUND' USING ERRCODE = '02000';
  END IF;
  RETURN v_row;
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_get_automation_audited(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_get_automation_audited(text) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_get_automation_audited(text) TO service_role;
