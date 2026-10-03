-- Function: public.get_user_symptom_logs_audited
-- Arguments: p_limit integer DEFAULT 30, p_user_id uuid DEFAULT NULL::uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_user_symptom_logs_audited(p_limit integer DEFAULT 30, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(category text, ended_at timestamptz, id uuid, logged_at timestamptz, notes text, severity integer, started_at timestamptz, symptom_code text, symptom_name text)
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

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
    p_action_type := 'view',
    p_area := 'operational_data',
    p_details := jsonb_build_object(
      'access_type', CASE WHEN v_is_admin THEN 'admin' ELSE 'consultant' END,
      'limit', p_limit,
      'user_id', p_user_id
    ),
    p_entity_id := NULL,
    p_entity_type := 'symptom_log',
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'notice',
    p_summary := 'Professional viewed user symptom logs',
    p_tags := ARRAY['phi', 'user_data', 'symptom_logs', 'summary'],
    p_user_id := v_caller_id
  );

  RETURN QUERY
  SELECT
    COALESCE(sc.category, 'general') AS category,
    mhl.ended_at,
    mhl.id,
    mhl.logged_at,
    mhl.notes,
    mhl.severity,
    mhl.started_at,
    COALESCE(sc.code, mhs.name_key) AS symptom_code,
    COALESCE(mhs.custom_name, sc.code, mhs.name_key) AS symptom_name
  FROM public.member_health_logs mhl
  JOIN public.member_health_states mhs ON mhs.id = mhl.state_id
  LEFT JOIN public.symptom_catalog sc ON sc.id = mhs.catalog_id
  WHERE mhl.user_id = p_user_id
  ORDER BY mhl.logged_at DESC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_symptom_logs_audited(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_symptom_logs_audited(integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_symptom_logs_audited(integer, uuid) TO service_role;
