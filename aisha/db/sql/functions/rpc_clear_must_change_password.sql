-- Function: public.rpc_clear_must_change_password
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:04+01:00

CREATE OR REPLACE FUNCTION public.rpc_clear_must_change_password()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Update user metadata
  UPDATE aisha_auth.users
  SET raw_user_meta_data = raw_user_meta_data - 'must_change_password'
  WHERE id = auth.uid();

  -- Log the action
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'auth'::journal_area,
      p_details := NULL,
      p_entity_id := auth.uid()::text,
      p_entity_type := 'user_password_flag',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User cleared must_change_password flag',
      p_tags := ARRAY['auth', 'password'],
      p_user_id := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.rpc_clear_must_change_password() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_clear_must_change_password() TO authenticated;
