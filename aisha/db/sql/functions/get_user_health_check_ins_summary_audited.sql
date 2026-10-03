-- Function: public.get_user_health_check_ins_summary_audited
-- Arguments: p_user_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_user_health_check_ins_summary_audited(p_user_id uuid)
 RETURNS TABLE(id uuid, check_in_date date, check_in_type check_in_type, pain_level integer, energy_level integer, mood_level integer, sleep_hours numeric, sleep_quality integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_is_admin boolean;
  v_is_consultant boolean;
  v_has_consent boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_caller_id);
  v_is_consultant := public.is_consultant_for_user(p_user_id);
  v_has_consent := public.has_data_sharing_consent(p_user_id, v_caller_id);

  IF NOT v_is_admin AND NOT (v_is_consultant AND v_has_consent) THEN
    RAISE EXCEPTION 'Access denied: No valid relationship or consent found for this user.';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'operational_data',
      p_details := jsonb_build_object(
      'user_id', p_user_id,
      'limit', 30,
      'access_type', CASE WHEN v_is_admin THEN 'admin' ELSE 'consultant' END
    ),
      p_entity_id := NULL,
      p_entity_type := 'health_check_in',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Professional viewed user health check-in summary',
      p_tags := ARRAY['phi', 'user_data', 'health_check_ins', 'summary'],
      p_user_id := v_caller_id
  );

  RETURN QUERY
  SELECT
    h.id,
    h.check_in_date,
    h.check_in_type,
    h.pain_level,
    h.energy_level,
    h.mood_level,
    h.sleep_hours,
    h.sleep_quality
  FROM public.health_check_ins h
  WHERE h.user_id = p_user_id
  ORDER BY h.check_in_date DESC
  LIMIT 30;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_health_check_ins_summary_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_health_check_ins_summary_audited(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_health_check_ins_summary_audited(uuid) TO service_role;
