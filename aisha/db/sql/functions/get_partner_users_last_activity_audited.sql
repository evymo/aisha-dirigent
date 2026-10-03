-- Function: public.get_partner_users_last_activity_audited
-- Arguments: p_user_ids uuid[]
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:12+01:00

CREATE OR REPLACE FUNCTION public.get_partner_users_last_activity_audited(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, display_name text, last_check_in_date date, last_lab_date date, last_dosing_date timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_admin boolean;
  v_valid_user_ids uuid[];
BEGIN
  -- Authorization check using explicit table alias
  IF NOT EXISTS (SELECT 1 FROM partner_profiles pp WHERE pp.user_id = v_caller_id)
     AND NOT public.is_admin_or_staff(v_caller_id) THEN
    RAISE EXCEPTION 'Unauthorized: must be partner or admin/staff';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_caller_id);

  -- Filter to only users with valid data_sharing_consent (unless admin)
  IF v_is_admin THEN
    v_valid_user_ids := p_user_ids;
  ELSE
    SELECT array_agg(pid) INTO v_valid_user_ids
    FROM unnest(p_user_ids) AS pid
    WHERE public.has_data_sharing_consent(pid, v_caller_id);
  END IF;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'partners',
      p_details := jsonb_build_object('user_count', array_length(p_user_ids, 1)),
      p_entity_id := NULL,
      p_entity_type := 'user_activity',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner viewed users last activity',
      p_tags := ARRAY['partner', 'users', 'activity'],
      p_user_id := v_caller_id
  );

  RETURN QUERY
  SELECT 
    p.user_id,
    p.display_name,
    (SELECT MAX(hci.check_in_date) FROM health_check_ins hci WHERE hci.user_id = p.user_id) as last_check_in_date,
    (SELECT MAX(lr.result_date) FROM lab_results lr WHERE lr.user_id = p.user_id) as last_lab_date,
    (SELECT MAX(dl.dosed_at) FROM dosing_logs dl WHERE dl.user_id = p.user_id) as last_dosing_date
  FROM profiles p
  WHERE p.user_id = ANY(v_valid_user_ids)
  ORDER BY p.display_name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_users_last_activity_audited(p_user_ids uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_partner_users_last_activity_audited(p_user_ids uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_users_last_activity_audited(p_user_ids uuid[]) TO authenticated;
