-- Function: aitg_update_automation_audited

CREATE OR REPLACE FUNCTION public.aitg_update_automation_audited(p_automation_id text, p_mode text DEFAULT NULL::text, p_schedule_cron text DEFAULT NULL::text, p_schedule_interval_minutes integer DEFAULT NULL::integer, p_parameters jsonb DEFAULT NULL::jsonb)
 RETURNS aitg_automation_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.aitg_automation_settings;
  v_changed jsonb := '{}'::jsonb;
BEGIN
  -- Mutations are admin-only (no service_role fallback) — operators decide
  -- cadence, not Aisha. Aisha can REQUEST changes via a proposal mechanism
  -- (out of scope for this RPC).
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NOT NULL AND p_mode NOT IN ('automated','manual','disabled') THEN
    RAISE EXCEPTION 'AITG_INVALID_MODE' USING ERRCODE = '22023';
  END IF;
  IF p_schedule_interval_minutes IS NOT NULL
     AND (p_schedule_interval_minutes < 1 OR p_schedule_interval_minutes > 1440) THEN
    RAISE EXCEPTION 'AITG_INVALID_INTERVAL' USING ERRCODE = '22023';
  END IF;

  UPDATE public.aitg_automation_settings
  SET
    mode = COALESCE(p_mode, mode),
    schedule_cron = COALESCE(p_schedule_cron, schedule_cron),
    schedule_interval_minutes = COALESCE(p_schedule_interval_minutes, schedule_interval_minutes),
    parameters = COALESCE(p_parameters, parameters),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE automation_id = p_automation_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AITG_AUTOMATION_NOT_FOUND' USING ERRCODE = '02000';
  END IF;

  IF p_mode IS NOT NULL                       THEN v_changed := v_changed || jsonb_build_object('mode', p_mode); END IF;
  IF p_schedule_cron IS NOT NULL              THEN v_changed := v_changed || jsonb_build_object('cron', p_schedule_cron); END IF;
  IF p_schedule_interval_minutes IS NOT NULL  THEN v_changed := v_changed || jsonb_build_object('interval_min', p_schedule_interval_minutes); END IF;
  IF p_parameters IS NOT NULL                 THEN v_changed := v_changed || jsonb_build_object('parameters_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_parameters) k)); END IF;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.automation_updated', 'aitg.automation_updated',
          'security', 'warn', ARRAY['aitg','automation','config', p_automation_id],
          jsonb_build_object('automation_id', p_automation_id, 'changes', v_changed));

  RETURN v_row;
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_update_automation_audited(text,text,text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_update_automation_audited(text,text,text,integer,jsonb) TO authenticated;
