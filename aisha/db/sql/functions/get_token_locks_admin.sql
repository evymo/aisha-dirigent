-- Function: public.get_token_locks_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:41+01:00

CREATE OR REPLACE FUNCTION public.get_token_locks_admin()
 RETURNS TABLE(amount numeric, created_at timestamptz, id uuid, is_active boolean, lock_end timestamptz, lock_reason text, lock_start timestamptz, notes text, profile_display_name text, profile_email text, token_type text, unlock_condition text, unlock_schedule jsonb, unlocked_amount numeric, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Permission denied: Admin or staff access required';
  END IF;

  -- Audit log for admin sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'token_locks',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing token locks with user info',
      p_tags := ARRAY['phi','admin','tokens'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    tl.amount,
    tl.created_at::text,
    tl.id,
    tl.is_active,
    tl.lock_end::text,
    tl.lock_reason,
    tl.lock_start::text,
    tl.notes,
    p.display_name AS profile_display_name,
    u.email::text AS profile_email,
    tl.token_type,
    tl.unlock_condition,
    COALESCE(tl.unlock_schedule::text, '') AS unlock_schedule,
    tl.unlocked_amount,
    tl.user_id
  FROM token_locks tl
  LEFT JOIN profiles p ON p.user_id = tl.user_id
  LEFT JOIN aisha_auth.users u ON u.id = tl.user_id
  ORDER BY tl.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_token_locks_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_locks_admin() TO authenticated;
