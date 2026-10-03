-- Function: public.submit_test_attempt
-- Arguments: p_attempt_id uuid, p_answers jsonb
-- Description: Grades a System-B test attempt server-side against test_questions for the
--   attempt's template and records the verdict on the attempt row. The score/pass are
--   computed here (never trusted from the client) and correct_answer is read under
--   SECURITY DEFINER (test_questions is admin-only via RLS). One submission per attempt.
-- Security: SECURITY DEFINER, authenticated only.

CREATE OR REPLACE FUNCTION public.submit_test_attempt(p_attempt_id uuid, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_attempt public.test_attempts%ROWTYPE;
  v_passing integer;
  v_total integer := 0;
  v_correct integer := 0;
  v_score integer := 0;
  v_passed boolean := false;
  v_q record;
  v_answer text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;
  IF v_attempt.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Not authorized for this attempt' USING ERRCODE = '42501';
  END IF;
  IF v_attempt.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Attempt already submitted';
  END IF;

  SELECT COALESCE(passing_score, 80) INTO v_passing
  FROM public.test_templates WHERE id = v_attempt.template_id;

  SELECT count(*) INTO v_total
  FROM public.test_questions
  WHERE template_id = v_attempt.template_id AND is_active = true;

  IF v_total > 0 THEN
    FOR v_q IN
      SELECT id, correct_answer FROM public.test_questions
      WHERE template_id = v_attempt.template_id AND is_active = true
    LOOP
      v_answer := p_answers ->> v_q.id::text;
      IF v_answer IS NOT NULL AND v_answer = v_q.correct_answer THEN
        v_correct := v_correct + 1;
      END IF;
    END LOOP;
    v_score := round((v_correct::numeric / v_total::numeric) * 100);
  END IF;

  v_passed := v_total > 0 AND v_score >= COALESCE(v_passing, 80);

  UPDATE public.test_attempts
  SET answers = p_answers,
      score = v_score,
      passed = v_passed,
      completed_at = now()
  WHERE id = p_attempt_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area := 'studies'::journal_area,
    p_details := jsonb_build_object(
      'template_id', v_attempt.template_id,
      'score', v_score,
      'passed', v_passed
    ),
    p_entity_id := p_attempt_id::text,
    p_entity_type := 'test_attempt',
    p_severity := 'info'::journal_severity,
    p_summary := 'Member submitted a study test attempt',
    p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'passed', v_passed,
    'score', v_score,
    'total_questions', v_total,
    'correct_count', v_correct,
    'passing_score', COALESCE(v_passing, 80)
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_test_attempt(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_test_attempt(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_test_attempt(uuid, jsonb) TO service_role;
