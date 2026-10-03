-- Function: public.get_registration_questionnaire_responses
-- Arguments: p_registration_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_registration_questionnaire_responses(p_registration_id uuid)
 RETURNS TABLE(id uuid, questionnaire_id uuid, completed_at timestamptz, responses jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user owns the registration, is consultant, or is admin/staff
  IF NOT is_admin_or_staff(v_user_id) AND NOT EXISTS (
    SELECT 1 FROM study_registrations se
    WHERE se.id = p_registration_id
      AND (se.user_id = v_user_id OR is_consultant_for_registration(p_registration_id))
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'study',
      p_details := jsonb_build_object('registration_id', p_registration_id),
      p_entity_id := NULL,
      p_entity_type := 'questionnaire_responses',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Viewing registration questionnaire responses',
      p_tags := ARRAY['phi','study','questionnaire'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    qr.id,
    qr.questionnaire_id,
    qr.completed_at,
    qr.responses
  FROM questionnaire_responses qr
  WHERE qr.registration_id = p_registration_id
  ORDER BY qr.completed_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_registration_questionnaire_responses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_registration_questionnaire_responses(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_registration_questionnaire_responses(uuid) TO service_role;
