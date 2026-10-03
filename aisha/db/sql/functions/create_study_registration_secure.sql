-- Function: public.create_study_registration_secure
-- Arguments: p_study_id uuid, p_consultant_id uuid, p_group_assignment text, p_baseline_data jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:15+01:00

CREATE OR REPLACE FUNCTION public.create_study_registration_secure(p_study_id uuid, p_consultant_id uuid DEFAULT NULL::uuid, p_group_assignment text DEFAULT NULL::text, p_baseline_data jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Check if user already enrolled
  IF EXISTS (
    SELECT 1 FROM study_registrations 
    WHERE study_id = p_study_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Already enrolled in this study';
  END IF;

  INSERT INTO study_registrations (
    user_id, study_id, consultant_id, group_assignment, 
    baseline_data, status, enrolled_at
  ) VALUES (
    v_user_id, p_study_id, p_consultant_id, p_group_assignment,
    p_baseline_data, 'enrolled', now()
  )
  RETURNING id INTO v_id;

  -- Log audit
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'research'::journal_area,
      p_entity_id := v_id::text,
      p_entity_type := 'study_registration',
      p_severity := 'info'::journal_severity,
      p_summary := 'User enrolled in study',
    p_user_id := v_user_id
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_study_registration_secure(p_study_id uuid, p_consultant_id uuid, p_group_assignment text, p_baseline_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_study_registration_secure(p_study_id uuid, p_consultant_id uuid, p_group_assignment text, p_baseline_data jsonb) TO authenticated;
