-- Function: public.update_test_question_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:54.608Z

CREATE OR REPLACE FUNCTION public.update_test_question_admin(p_question_id uuid, p_correct_answer text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean, p_question_order integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can update test questions';
  END IF;

  UPDATE public.test_questions
  SET
    question_order = COALESCE(p_question_order, question_order),
    correct_answer = COALESCE(p_correct_answer, correct_answer),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = p_question_id;

  -- Until 2026-09-29 the values sat on the wrong names (p_area := 'update',
  -- text into p_details, jsonb into p_entity_id) and every call failed.
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'admin'::journal_area,
      p_details := jsonb_build_object('question_id', p_question_id),
      p_entity_id := p_question_id::text,
      p_entity_type := 'test_question',
      p_severity := 'info'::journal_severity,
      p_summary := 'Test question updated by admin',
    p_user_id := auth.uid()
  );

  RETURN p_question_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_test_question_admin(uuid, text, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_test_question_admin(uuid, text, boolean, integer) TO authenticated;

