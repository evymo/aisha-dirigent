-- Function: public.activate_rii_registration_after_questionnaire
-- Arguments: p_registration_id uuid, p_baseline_data jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:49+01:00

CREATE OR REPLACE FUNCTION public.activate_rii_registration_after_questionnaire(p_registration_id uuid, p_baseline_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_registration record;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Get registration and verify ownership
  SELECT * INTO v_registration
  FROM study_registrations
  WHERE id = p_registration_id AND user_id = v_user_id;

  IF v_registration IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Registration not found');
  END IF;

  -- Update registration with baseline data
  UPDATE study_registrations
  SET 
    baseline_data = p_baseline_data,
    updated_at = now()
  WHERE id = p_registration_id AND user_id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'registration_id', p_registration_id
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.activate_rii_registration_after_questionnaire(p_registration_id uuid, p_baseline_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_rii_registration_after_questionnaire(p_registration_id uuid, p_baseline_data jsonb) TO authenticated;
