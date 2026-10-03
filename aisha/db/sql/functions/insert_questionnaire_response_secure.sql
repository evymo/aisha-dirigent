-- Function: public.insert_questionnaire_response_secure
-- Arguments: p_questionnaire_id uuid, p_responses jsonb, p_study_registration_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:52+01:00

CREATE OR REPLACE FUNCTION public.insert_questionnaire_response_secure(p_questionnaire_id uuid, p_responses jsonb, p_study_registration_id uuid DEFAULT NULL::uuid)
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

  -- Verify registration belongs to user if provided
  IF p_study_registration_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM study_registrations 
      WHERE id = p_study_registration_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Invalid study registration' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO questionnaire_responses (
    user_id, questionnaire_id, responses, study_registration_id, completed_at
  ) VALUES (
    v_user_id, p_questionnaire_id, p_responses, p_study_registration_id, now()
  )
  RETURNING id INTO v_id;

  -- Log audit
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'research'::journal_area,
      p_entity_id := v_id::text,
      p_entity_type := 'questionnaire_response',
      p_severity := 'info'::journal_severity,
      p_summary := 'Questionnaire response submitted',
    p_user_id := v_user_id
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.insert_questionnaire_response_secure(p_questionnaire_id uuid, p_responses jsonb, p_study_registration_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_questionnaire_response_secure(p_questionnaire_id uuid, p_responses jsonb, p_study_registration_id uuid) TO authenticated;
