-- Function: public.create_test_question_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:52.390Z

CREATE OR REPLACE FUNCTION public.create_test_question_admin(p_test_type text, p_correct_answer text, p_is_active boolean DEFAULT true, p_question_order integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_question_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can create test questions';
  END IF;

  INSERT INTO public.test_questions (
    test_type,
    question_order,
    correct_answer,
    is_active
  ) VALUES (
    p_test_type,
    p_question_order,
    p_correct_answer,
    p_is_active
  )
  RETURNING id INTO v_question_id;

  -- Auto-generate translation keys from newly created ID
  UPDATE public.test_questions SET
    question_key = 'test_question.' || v_question_id || '.question',
    option_a_key = 'test_question.' || v_question_id || '.option_a',
    option_b_key = 'test_question.' || v_question_id || '.option_b',
    option_c_key = 'test_question.' || v_question_id || '.option_c',
    option_d_key = 'test_question.' || v_question_id || '.option_d'
  WHERE id = v_question_id;

  -- Until 2026-09-29 the values sat on the wrong names (p_area := 'create',
  -- text into p_details, jsonb into p_entity_id) and every call failed.
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'admin'::journal_area,
      p_details := jsonb_build_object('test_type', p_test_type, 'question_order', p_question_order),
      p_entity_id := v_question_id::text,
      p_entity_type := 'test_question',
      p_severity := 'info'::journal_severity,
      p_summary := 'Test question created by admin',
    p_user_id := auth.uid()
  );

  RETURN v_question_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_test_question_admin(text, text, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_test_question_admin(text, text, boolean, integer) TO authenticated;

