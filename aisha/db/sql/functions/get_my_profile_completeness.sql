-- Function: public.get_my_profile_completeness
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:02+01:00

CREATE OR REPLACE FUNCTION public.get_my_profile_completeness()
 RETURNS TABLE(has_display_name boolean, has_umbrella_registration boolean, is_new_user boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_has_display_name BOOLEAN := FALSE;
  v_has_umbrella_registration BOOLEAN := FALSE;
  v_is_new_user BOOLEAN := FALSE;
  v_created_at TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE;
    RETURN;
  END IF;

  -- Audit log for profile access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'profiles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member checking profile completeness',
      p_tags := ARRAY['phi','member','profile'],
      p_user_id := v_user_id
  );

  -- Check display name
  SELECT 
    COALESCE(display_name, '') != '' AND display_name IS NOT NULL,
    p.created_at
  INTO v_has_display_name, v_created_at
  FROM profiles p
  WHERE p.user_id = v_user_id;

  -- Check umbrella registration
  SELECT EXISTS (
    SELECT 1 
    FROM study_registrations se
    JOIN studies s ON s.id = se.study_id
    WHERE se.user_id = v_user_id
    AND s.is_umbrella = TRUE
    AND se.status IN ('screening', 'enrolled', 'active', 'completed')
  ) INTO v_has_umbrella_registration;

  -- Consider user "new" if created within last 24 hours
  v_is_new_user := v_created_at IS NOT NULL AND v_created_at > (NOW() - INTERVAL '24 hours');

  RETURN QUERY SELECT v_has_display_name, v_has_umbrella_registration, v_is_new_user;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_profile_completeness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile_completeness() TO authenticated;
