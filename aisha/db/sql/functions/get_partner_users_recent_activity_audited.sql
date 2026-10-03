-- Function: public.get_partner_users_recent_activity_audited
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_partner_users_recent_activity_audited()
 RETURNS TABLE(user_id uuid, last_check_in_at timestamp with time zone, last_lab_at timestamp with time zone, last_document_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_partner_id uuid;
  v_user_count integer := 0;
BEGIN
  -- Authorization: must be partner or admin/staff
  SELECT pp.id INTO v_partner_id
  FROM public.partner_profiles pp
  WHERE pp.user_id = v_caller_id
  LIMIT 1;

  IF v_partner_id IS NULL AND NOT public.is_admin_or_staff(v_caller_id) THEN
    RAISE EXCEPTION 'Unauthorized: must be partner or admin/staff';
  END IF;

  WITH partner_users AS (
    SELECT DISTINCT se.user_id
    FROM public.study_registrations se
    JOIN public.study_consultants sc
      ON sc.study_id = se.study_id
     AND sc.partner_id = v_partner_id
    WHERE sc.status = 'approved'
      AND se.status IN ('active', 'completed', 'pending')
  ), counts AS (
    SELECT COUNT(*)::int AS user_count
    FROM partner_users
  )
  SELECT user_count INTO v_user_count
  FROM counts;

  PERFORM public.write_audit_journal(
      p_action_type := 'view'::public.journal_action_type,
      p_area := 'partners'::public.journal_area,
      p_details := jsonb_build_object('user_count', v_user_count),
      p_entity_id := NULL,
      p_entity_type := 'user_activity',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Partner viewed users recent activity',
      p_tags := ARRAY['partner', 'users', 'activity'],
      p_user_id := v_caller_id
  );

  RETURN QUERY
  WITH partner_users AS (
    SELECT DISTINCT se.user_id
    FROM public.study_registrations se
    JOIN public.study_consultants sc
      ON sc.study_id = se.study_id
     AND sc.partner_id = v_partner_id
    WHERE sc.status = 'approved'
      AND se.status IN ('active', 'completed', 'pending')
  ),
  consented_users AS (
    -- Filter to only users with valid data_sharing_consent (unless admin)
    SELECT pp.user_id
    FROM partner_users pp
    WHERE public.is_admin_or_staff(v_caller_id)
       OR public.has_data_sharing_consent(pp.user_id, v_caller_id)
  )
  SELECT
    p.user_id,
    (
      SELECT MAX(hci.created_at)
      FROM public.health_check_ins hci
      WHERE hci.user_id = p.user_id
    ) AS last_check_in_at,
    (
      SELECT MAX(lr.created_at)
      FROM public.lab_results lr
      WHERE lr.user_id = p.user_id
    ) AS last_lab_at,
    (
      SELECT MAX(mhd.created_at)
      FROM public.member_health_documents mhd
      WHERE mhd.user_id = p.user_id
    ) AS last_document_at
  FROM consented_users p
  ORDER BY p.user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_partner_users_recent_activity_audited() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_users_recent_activity_audited() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_users_recent_activity_audited() TO service_role;
