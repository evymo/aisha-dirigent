-- Function: public.get_questionnaire_response_detail_audited
-- Arguments: p_response_id uuid
-- Description: Returns full questionnaire response detail with questionnaire metadata. Audit logged.
-- Security: SECURITY DEFINER - checks self-access, partner/consultant consent, admin bypass.
-- @security: authenticated
-- @audit: SELECT on questionnaire_responses

CREATE OR REPLACE FUNCTION public.get_questionnaire_response_detail_audited(
  p_response_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor_id uuid;
  v_response_user_id uuid;
  v_partner_id uuid;
  v_has_access boolean := false;
  v_result jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get the owner of the response
  SELECT qr.user_id INTO v_response_user_id
  FROM questionnaire_responses qr
  WHERE qr.id = p_response_id;

  IF v_response_user_id IS NULL THEN
    RAISE EXCEPTION 'Response not found';
  END IF;

  -- Self-access
  IF v_actor_id = v_response_user_id THEN
    v_has_access := true;
  END IF;

  -- Partner/consultant access with consent check
  IF NOT v_has_access THEN
    SELECT pp.id INTO v_partner_id
    FROM partner_profiles pp
    WHERE pp.user_id = v_actor_id;

    IF v_partner_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM study_registrations se
        JOIN study_consultants sc ON sc.id = se.consultant_id
        WHERE se.user_id = v_response_user_id
          AND sc.partner_id = v_partner_id
          AND sc.status = 'approved'
      ) AND public.has_data_sharing_consent(v_response_user_id, v_actor_id)
      INTO v_has_access;
    END IF;
  END IF;

  -- Admin/staff bypass
  IF NOT v_has_access AND public.is_admin_or_staff(v_actor_id) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'Access denied to response data';
  END IF;

  -- Audit log (no sensitive data in metadata)
  INSERT INTO audit_journal (
    entity_type,
    entity_id,
    action,
    user_id,
    new_data
  ) VALUES (
    'questionnaire_responses',
    p_response_id,
    'SELECT',
    v_actor_id,
    jsonb_build_object('context', 'response_detail_view')
  );

  -- Build response detail
  SELECT jsonb_build_object(
    'id', qr.id,
    'user_id', qr.user_id,
    'questionnaire_id', qr.questionnaire_id,
    'responses', qr.responses,
    'score', qr.score,
    'completed_at', qr.completed_at,
    'created_at', qr.created_at,
    'questionnaire_version', qr.questionnaire_version,
    'response_version', qr.response_version,
    'questionnaire_name', q.name,
    'questionnaire_name_key', q.name_key,
    'questionnaire_code', q.code,
    'questionnaire_description', q.description,
    'questionnaire_description_key', q.description_key,
    'questionnaire_questions', q.questions,
    'questionnaire_type', q.questionnaire_type
  ) INTO v_result
  FROM questionnaire_responses qr
  JOIN questionnaires q ON q.id = qr.questionnaire_id
  WHERE qr.id = p_response_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_questionnaire_response_detail_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_questionnaire_response_detail_audited(uuid) TO authenticated;
