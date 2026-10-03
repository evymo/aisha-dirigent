-- Function: public.validate_test_answers
-- Arguments: p_test_type text, p_answers jsonb
-- Description: Validates test answers and returns score. Used in public quiz flow.
-- Security: SECURITY DEFINER - public quiz validation.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.validate_test_answers(p_test_type text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_questions integer;
  v_correct_count integer := 0;
  v_question record;
  v_user_answer text;
BEGIN
  -- Count total active questions for this test type
  SELECT COUNT(*) INTO v_total_questions
  FROM test_questions
  WHERE test_type = p_test_type AND is_active = true;

  -- Check each answer
  FOR v_question IN 
    SELECT id, correct_answer 
    FROM test_questions 
    WHERE test_type = p_test_type AND is_active = true
  LOOP
    v_user_answer := p_answers->>v_question.id::text;
    IF v_user_answer IS NOT NULL AND v_user_answer = v_question.correct_answer THEN
      v_correct_count := v_correct_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total_questions', v_total_questions,
    'correct_count', v_correct_count,
    'score', CASE WHEN v_total_questions > 0 
      THEN ROUND((v_correct_count::numeric / v_total_questions::numeric) * 100)
      ELSE 0 
    END,
    'passed', CASE WHEN v_total_questions > 0 
      THEN (v_correct_count::numeric / v_total_questions::numeric) >= 0.75
      ELSE false 
    END
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.validate_test_answers(p_test_type text, p_answers jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_test_answers(p_test_type text, p_answers jsonb) TO public;
