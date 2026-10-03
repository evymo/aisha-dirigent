-- Function: public.rpc_check_must_change_password
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:03+01:00

CREATE OR REPLACE FUNCTION public.rpc_check_must_change_password()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_must_change BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Audit log for profile access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'auth',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'profiles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Checking must_change_password flag',
      p_tags := ARRAY['phi','member','auth'],
      p_user_id := v_user_id
  );
  
  SELECT COALESCE(must_change_password, false) INTO v_must_change
  FROM profiles WHERE user_id = v_user_id;
  
  RETURN COALESCE(v_must_change, false);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.rpc_check_must_change_password() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_check_must_change_password() TO authenticated;
