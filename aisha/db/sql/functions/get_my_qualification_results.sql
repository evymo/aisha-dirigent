-- Function: public.get_my_qualification_results
-- Arguments: p_questionnaire_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:03+01:00

CREATE OR REPLACE FUNCTION public.get_my_qualification_results(p_questionnaire_id uuid)
 RETURNS SETOF questionnaire_responses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := jsonb_build_object('questionnaire_id', p_questionnaire_id),
      p_entity_id := NULL,
      p_entity_type := 'questionnaire_responses',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewing qualification results',
      p_tags := ARRAY['phi','member','questionnaire'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    qr.id,
    qr.user_id,
    qr.questionnaire_id,
    qr.responses,
    qr.score,
    qr.completed_at,
    qr.created_at,
    qr.questionnaire_version,
    qr.response_version,
    qr.supersedes_response_id,
    qr.study_registration_id,
    qr.registration_id
  FROM public.questionnaire_responses qr
  WHERE qr.user_id = v_user_id AND qr.questionnaire_id = p_questionnaire_id
  ORDER BY qr.created_at DESC LIMIT 1;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_qualification_results(p_questionnaire_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_qualification_results(p_questionnaire_id uuid) TO authenticated;
