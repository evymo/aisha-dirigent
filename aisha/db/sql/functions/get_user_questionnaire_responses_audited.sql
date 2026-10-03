-- Function: public.get_user_questionnaire_responses_audited
-- Arguments: p_user_id uuid, p_limit integer DEFAULT 10
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_user_questionnaire_responses_audited(p_user_id uuid, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_partner_id uuid;
  v_has_access boolean := false;
  v_result jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT pp.id INTO v_partner_id
  FROM partner_profiles pp
  WHERE pp.user_id = v_actor_id;

  IF v_partner_id IS NOT NULL THEN
    -- Check consultant relationship AND data_sharing_consent
    SELECT EXISTS (
      SELECT 1 FROM study_registrations se
      JOIN study_consultants sc ON sc.id = se.consultant_id
      WHERE se.user_id = p_user_id
        AND sc.partner_id = v_partner_id
        AND sc.status = 'approved'
    ) AND public.has_data_sharing_consent(p_user_id, v_actor_id)
    INTO v_has_access;
  END IF;

  -- Admin bypass
  IF NOT v_has_access AND public.is_admin_or_staff(v_actor_id) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'Access denied to user data';
  END IF;

  INSERT INTO audit_journal (
    entity_type,
    entity_id,
    action,
    user_id,
    new_data
  ) VALUES (
    'questionnaire_responses',
    p_user_id,
    'SELECT',
    v_actor_id,
    jsonb_build_object('context', 'consultant_user_view')
  );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', qr.id,
        'completed_at', qr.completed_at,
        'questionnaire_id', qr.questionnaire_id,
        'questionnaire_name', q.name,
        'questionnaire_name_key', q.name_key,
        'questionnaire_code', q.code,
        'questionnaire_version', qr.questionnaire_version
      ) ORDER BY qr.completed_at DESC
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT id, completed_at, questionnaire_id, questionnaire_version
    FROM questionnaire_responses
    WHERE user_id = p_user_id
    ORDER BY completed_at DESC
    LIMIT p_limit
  ) qr
  LEFT JOIN questionnaires q ON q.id = qr.questionnaire_id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_questionnaire_responses_audited(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_questionnaire_responses_audited(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_questionnaire_responses_audited(uuid, integer) TO service_role;
