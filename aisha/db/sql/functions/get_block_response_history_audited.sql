-- Function: public.get_block_response_history_audited
-- Arguments: p_block_code text, p_questionnaire_code text, p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:40+01:00

CREATE OR REPLACE FUNCTION public.get_block_response_history_audited(p_block_code text, p_questionnaire_code text DEFAULT NULL::text, p_limit integer DEFAULT 30)
 RETURNS TABLE(response_id uuid, block_code text, question_type text, response_value jsonb, completed_at timestamptz)
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

  RETURN QUERY
  SELECT 
    qr.id AS response_id,
    qb.code AS block_code,
    qb.question_type,
    qr.responses->qb.code AS response_value,
    qr.completed_at
  FROM questionnaire_responses qr
  JOIN questionnaires q ON q.id = qr.questionnaire_id
  JOIN questionnaire_blocks qblk ON qblk.questionnaire_id = q.id
  JOIN question_blocks qb ON qb.id = qblk.block_id
  WHERE qr.user_id = v_user_id
    AND qb.code = p_block_code
    AND qr.responses ? p_block_code
    AND (p_questionnaire_code IS NULL OR q.code = p_questionnaire_code)
  ORDER BY qr.completed_at DESC
  LIMIT p_limit;

  -- Audit log
  INSERT INTO audit_journal (action, 
    action_type, area, entity_type, entity_id, 
    user_id, severity, summary, details
  ) VALUES ('GET_BLOCK_RESPONSE_HISTORY_AUDITED', 
    'read', 'data', 'block_response_history', p_block_code,
    v_user_id, 'info', 
    'Block response history retrieved',
    jsonb_build_object('block_code', p_block_code, 'questionnaire_code', p_questionnaire_code, 'limit', p_limit)
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_block_response_history_audited(p_block_code text, p_questionnaire_code text, p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_block_response_history_audited(p_block_code text, p_questionnaire_code text, p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_block_response_history_audited(p_block_code text, p_questionnaire_code text, p_limit integer) TO authenticated;
