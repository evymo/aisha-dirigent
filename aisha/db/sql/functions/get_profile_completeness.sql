-- Function: public.get_profile_completeness
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:25+01:00

CREATE OR REPLACE FUNCTION public.get_profile_completeness()
 RETURNS TABLE(has_display_name boolean, has_umbrella_registration boolean, is_new_user boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_display_name TEXT;
  v_created_at TIMESTAMPTZ;
  v_has_umbrella BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, false, false;
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

  -- Get profile info
  SELECT p.display_name, p.created_at 
  INTO v_display_name, v_created_at
  FROM profiles p
  WHERE p.user_id = v_user_id;

  -- Check umbrella registration (RII study)
  SELECT EXISTS (
    SELECT 1 
    FROM study_registrations se
    JOIN studies s ON s.id = se.study_id
    WHERE se.user_id = v_user_id
      AND (s.is_umbrella = true OR s.slug = 'rii' OR s.name ILIKE '%reinvented%')
      AND se.status IN ('enrolled', 'active', 'screening')
  ) INTO v_has_umbrella;

  RETURN QUERY SELECT 
    COALESCE(v_display_name IS NOT NULL AND v_display_name <> '', false),
    v_has_umbrella,
    COALESCE((EXTRACT(EPOCH FROM (now() - v_created_at)) < 3600), false);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_profile_completeness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_completeness() TO authenticated;
