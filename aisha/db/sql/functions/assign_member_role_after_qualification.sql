-- Function: public.assign_member_role_after_qualification
-- Arguments: p_test_type text, p_answers jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:52+01:00

CREATE OR REPLACE FUNCTION public.assign_member_role_after_qualification(p_test_type text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_user_id uuid;
  v_passed boolean;
  v_existing_role_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not authenticated'
    );
  END IF;

  -- Validate test answers using existing function
  v_result := validate_test_answers(p_test_type, p_answers);
  v_passed := (v_result->>'passed')::boolean;

  -- Record server-authored evidence of every qualification attempt. This is the
  -- non-forgeable source of truth for is_qualified() — clients no longer hold write
  -- access to qualification_results (see grants), so only this SECURITY DEFINER path
  -- can attest a pass. Score is the server-graded value, never client-supplied.
  IF p_test_type = 'qualification' THEN
    INSERT INTO public.qualification_results (user_id, score, passed, completed_at, answers)
    VALUES (
      v_user_id,
      COALESCE((v_result->>'score')::integer, 0),
      v_passed,
      now(),
      p_answers
    );
  END IF;

  -- If passed qualification test, assign member role
  IF v_passed AND p_test_type = 'qualification' THEN
    SELECT id INTO v_existing_role_id
    FROM public.user_roles
    WHERE user_id = v_user_id AND role = 'member';

    IF v_existing_role_id IS NULL THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (v_user_id, 'member');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'passed', v_passed,
    'total_questions', v_result->'total_questions',
    'correct_count', v_result->'correct_count',
    'score', v_result->'score',
    'role_assigned', (v_passed AND p_test_type = 'qualification')
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.assign_member_role_after_qualification(p_test_type text, p_answers jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_member_role_after_qualification(p_test_type text, p_answers jsonb) TO authenticated;
