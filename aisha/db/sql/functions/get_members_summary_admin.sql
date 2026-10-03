-- Function: public.get_members_summary_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:50+01:00

CREATE OR REPLACE FUNCTION public.get_members_summary_admin()
 RETURNS TABLE(id uuid, user_id uuid, display_name text, email text, membership_tier text, membership_status text, total_check_ins bigint, last_check_in timestamp with time zone, registrations_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Check if user is admin or staff
  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Audit log for admin sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'profiles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing members summary',
      p_tags := ARRAY['phi','admin','members'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    p.id,
    p.user_id,
    p.display_name,
    p.email,
    m.tier::text as membership_tier,
    m.status::text as membership_status,
    COALESCE(hc.cnt, 0) as total_check_ins,
    hc.last_date as last_check_in,
    COALESCE(se.cnt, 0) as registrations_count
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT tier, status FROM memberships WHERE memberships.user_id = p.user_id ORDER BY created_at DESC LIMIT 1
  ) m ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as cnt, MAX(created_at) as last_date 
    FROM health_check_ins WHERE health_check_ins.user_id = p.user_id
  ) hc ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as cnt FROM study_registrations WHERE study_registrations.user_id = p.user_id
  ) se ON true
  ORDER BY p.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_members_summary_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_members_summary_admin() TO authenticated;
