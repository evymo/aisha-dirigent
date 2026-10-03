-- Function: public.mark_password_set
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:58+01:00

CREATE OR REPLACE FUNCTION public.mark_password_set()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit log for profile update
  PERFORM public.write_audit_journal(
      p_action_type := 'update',
      p_area := 'auth',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'profiles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'User marking password as set',
      p_tags := ARRAY['phi','member','auth'],
      p_user_id := v_user_id
  );

  UPDATE profiles
  SET 
    must_change_password = false,
    updated_at = NOW()
  WHERE user_id = v_user_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.mark_password_set() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_password_set() TO authenticated;
