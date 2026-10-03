-- Function: public.get_test_questions_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:53.977Z

CREATE OR REPLACE FUNCTION public.get_test_questions_admin(p_test_type text)
 RETURNS TABLE(id uuid, test_type text, question_key text, option_a_key text, option_b_key text, option_c_key text, option_d_key text, correct_answer text, question_order integer, is_active boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;

  INSERT INTO audit_journal (
    action, user_id, action_type, entity_type, area, severity, summary
  ) VALUES (
    'GET_TEST_QUESTIONS_ADMIN', auth.uid(), 'read'::journal_action_type, 'test_questions',
    'content'::journal_area, 'info'::journal_severity,
    'Admin viewed test questions for ' || p_test_type
  );

  RETURN QUERY
  SELECT tq.id, tq.test_type,
         COALESCE(tq.question_key, '') AS question_key,
         COALESCE(tq.option_a_key, '') AS option_a_key,
         COALESCE(tq.option_b_key, '') AS option_b_key,
         COALESCE(tq.option_c_key, '') AS option_c_key,
         COALESCE(tq.option_d_key, '') AS option_d_key,
         tq.correct_answer,
         tq.question_order, tq.is_active, tq.created_at, tq.updated_at
  FROM public.test_questions tq
  WHERE tq.test_type = p_test_type
  ORDER BY tq.question_order;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_test_questions_admin(p_test_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_test_questions_admin(p_test_type text) TO authenticated;

