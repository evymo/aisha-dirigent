-- Function: public.update_question_block_admin
-- Description: Updates a question block with unified translation keys.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.update_question_block_admin(
  p_id uuid,
  p_block_key text DEFAULT NULL::text,
  p_description_key text DEFAULT NULL::text,
  p_is_active boolean DEFAULT NULL::boolean,
  p_question_type text DEFAULT NULL::text,
  p_questions jsonb DEFAULT NULL::jsonb,
  p_sort_order integer DEFAULT NULL::integer,
  p_text_key text DEFAULT NULL::text
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current public.question_blocks%ROWTYPE;
  v_new_key text;
  v_usage_count integer := 0;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  SELECT * INTO v_current
  FROM public.question_blocks
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_usage_count
  FROM public.questionnaire_blocks qb
  WHERE qb.block_id = p_id;

  IF v_usage_count > 0
     AND p_question_type IS NOT NULL
     AND p_question_type IS DISTINCT FROM v_current.question_type THEN
    RAISE EXCEPTION 'Cannot change question type for block that is already used in questionnaires' USING ERRCODE = 'P0001';
  END IF;

  v_new_key := COALESCE(p_block_key, v_current.code);

  UPDATE public.question_blocks
  SET
    code = v_new_key,
    description_key = CASE
      WHEN p_description_key IS NOT NULL THEN p_description_key
      WHEN p_block_key IS NOT NULL AND p_block_key IS DISTINCT FROM v_current.code
      THEN format('questionnaires.blocks.%s.description', p_block_key)
      ELSE description_key
    END,
    text_key = CASE
      WHEN p_text_key IS NOT NULL THEN p_text_key
      WHEN p_block_key IS NOT NULL AND p_block_key IS DISTINCT FROM v_current.code
      THEN format('questionnaires.blocks.%s.text', p_block_key)
      ELSE text_key
    END,
    question_type = COALESCE(p_question_type, v_current.question_type),
    questions = COALESCE(p_questions, v_current.questions),
    config = CASE
      WHEN p_questions IS NULL THEN v_current.config
      ELSE jsonb_set(COALESCE(v_current.config, '{}'::jsonb), '{questions}', p_questions, true)
    END,
    is_active = COALESCE(p_is_active, v_current.is_active),
    sort_order = COALESCE(p_sort_order, v_current.sort_order),
    updated_at = now()
  WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'research'::journal_area,
      p_entity_id := p_id::text,
      p_entity_type := 'question_block',
      p_summary := format('Updated question block: %s', v_new_key),
    p_user_id := auth.uid()
  );

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_question_block_admin(uuid, text, text, boolean, text, jsonb, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_question_block_admin(uuid, text, text, boolean, text, jsonb, integer, text) TO authenticated;
