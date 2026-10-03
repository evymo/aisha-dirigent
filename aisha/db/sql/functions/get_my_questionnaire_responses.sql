-- Function: public.get_my_questionnaire_responses
-- Arguments: (none)
-- Description: Get user's questionnaire responses (sensitive data)
-- @security: authenticated
-- @audit: required
-- @phi: true

CREATE OR REPLACE FUNCTION public.get_my_questionnaire_responses()
 RETURNS TABLE(id uuid, questionnaire_id uuid, questionnaire_name text, questionnaire_code text, responses jsonb, study_registration_id uuid, completed_at timestamptz, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Audit sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'studies',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'questionnaire_responses',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewed questionnaire responses',
      p_tags := ARRAY['phi','member','questionnaire'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    qr.id, qr.questionnaire_id, q.name, q.code, qr.responses,
    qr.study_registration_id, qr.completed_at, qr.created_at
  FROM questionnaire_responses qr
  LEFT JOIN questionnaires q ON q.id = qr.questionnaire_id
  WHERE qr.user_id = auth.uid()
  ORDER BY qr.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_questionnaire_responses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_questionnaire_responses() TO authenticated;
