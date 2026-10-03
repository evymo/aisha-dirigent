-- Function: public.get_my_profile_phi
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:03+01:00

CREATE OR REPLACE FUNCTION public.get_my_profile_phi()
 RETURNS TABLE(display_name text, phone text, gender text, date_of_birth date, preferred_language text, primary_diagnosis text, current_medications text, allergies text, medical_history text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Audit: record access without persisting sensitive data content.
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'profile',
      p_details := jsonb_build_object('scope', 'self'),
      p_entity_id := auth.uid()::text,
      p_entity_type := 'profiles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'User accessed own sensitive data profile fields',
      p_tags := ARRAY['phi', 'self', 'profile'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    p.display_name,
    p.phone,
    p.gender,
    p.date_of_birth,
    p.preferred_language,
    p.primary_diagnosis,
    p.current_medications,
    p.allergies,
    p.medical_history
  FROM public.profiles p
  WHERE p.user_id = auth.uid();
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_profile_phi() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_phi() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_phi() TO authenticated;
