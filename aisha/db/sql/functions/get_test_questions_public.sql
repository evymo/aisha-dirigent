-- Function: public.get_test_questions_public
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:54.099Z

CREATE OR REPLACE FUNCTION public.get_test_questions_public(p_test_type text)
 RETURNS TABLE(id uuid, test_type text, question_order integer, question_key text, option_a_key text, option_b_key text, option_c_key text, option_d_key text, is_active boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    tq.id,
    tq.test_type::text,
    tq.question_order,
    COALESCE(tq.question_key, '') AS question_key,
    COALESCE(tq.option_a_key, '') AS option_a_key,
    COALESCE(tq.option_b_key, '') AS option_b_key,
    COALESCE(tq.option_c_key, '') AS option_c_key,
    COALESCE(tq.option_d_key, '') AS option_d_key,
    tq.is_active,
    tq.created_at,
    tq.updated_at
  FROM public.test_questions tq
  WHERE tq.test_type = p_test_type
    AND tq.is_active = true
  ORDER BY tq.question_order;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_test_questions_public(p_test_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_test_questions_public(p_test_type text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_test_questions_public(p_test_type text) TO authenticated;

