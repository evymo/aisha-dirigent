-- Function: public.get_my_questionnaire_completed
-- Arguments: p_questionnaire_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:03+01:00

CREATE OR REPLACE FUNCTION public.get_my_questionnaire_completed(p_questionnaire_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_result boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Audit log for questionnaire check
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := jsonb_build_object('questionnaire_id', p_questionnaire_id),
      p_entity_id := NULL,
      p_entity_type := 'questionnaire_responses',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member checking questionnaire completion',
      p_tags := ARRAY['phi','member','questionnaire'],
      p_user_id := v_user_id
  );

  SELECT EXISTS (
    SELECT 1 FROM public.questionnaire_responses qr
    WHERE qr.user_id = v_user_id
      AND qr.questionnaire_id = p_questionnaire_id
      AND qr.completed_at IS NOT NULL
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_questionnaire_completed(p_questionnaire_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_questionnaire_completed(p_questionnaire_id uuid) TO authenticated;
