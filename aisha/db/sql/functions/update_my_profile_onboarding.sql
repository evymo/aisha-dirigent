-- Function: public.update_my_profile_onboarding
-- Arguments: p_data jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:20+01:00

CREATE OR REPLACE FUNCTION public.update_my_profile_onboarding(p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE profiles SET
    display_name = COALESCE(p_data->>'display_name', display_name),
    phone = COALESCE(p_data->>'phone', phone),
    date_of_birth = CASE WHEN p_data ? 'date_of_birth' THEN (p_data->>'date_of_birth')::DATE ELSE date_of_birth END,
    primary_diagnosis = COALESCE(p_data->>'primary_diagnosis', primary_diagnosis),
    current_medications = COALESCE(p_data->>'current_medications', current_medications),
    medical_history = COALESCE(p_data->>'medical_history', medical_history),
    onboarding_completed = COALESCE((p_data->>'onboarding_completed')::BOOLEAN, onboarding_completed),
    updated_at = NOW()
  WHERE user_id = auth.uid();

  PERFORM public.write_audit_journal(
      p_action_type := 'update',
      p_area := 'users',
      p_entity_type := 'profile',
      p_summary := 'Profile updated via onboarding',
    p_user_id := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_my_profile_onboarding(p_data jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_my_profile_onboarding(p_data jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile_onboarding(p_data jsonb) TO authenticated;
