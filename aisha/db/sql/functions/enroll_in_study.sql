-- Function: public.enroll_in_study
-- Arguments: p_study_id uuid, p_baseline_data jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:28+01:00

CREATE OR REPLACE FUNCTION public.enroll_in_study(p_study_id uuid, p_baseline_data jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_study RECORD;
  v_existing_registration RECORD;
  v_registration_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, name INTO v_study FROM studies WHERE id = p_study_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study not found or not active';
  END IF;

  SELECT id INTO v_existing_registration 
  FROM study_registrations 
  WHERE user_id = v_user_id AND study_id = p_study_id AND status NOT IN ('withdrawn', 'completed');
  
  IF FOUND THEN
    RAISE EXCEPTION 'Already enrolled in this study';
  END IF;

  INSERT INTO study_registrations (user_id, study_id, status, baseline_data)
  VALUES (v_user_id, p_study_id, 'screening', p_baseline_data)
  RETURNING id INTO v_registration_id;

  INSERT INTO audit_journal (user_id, action, action_type, area, entity_type, entity_id, summary, severity, details)
  VALUES (v_user_id, 'ENROLL_STUDY', 'create', 'registrations', 'study_registration', v_registration_id::TEXT, 'User enrolled in study', 'notice',
    jsonb_build_object('study_id', p_study_id, 'study_name', v_study.name));

  RETURN jsonb_build_object('success', true, 'registration_id', v_registration_id);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.enroll_in_study(p_study_id uuid, p_baseline_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enroll_in_study(p_study_id uuid, p_baseline_data jsonb) TO authenticated;
