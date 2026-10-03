
-- Function: get_test_questions_admin_localized
-- Purpose: Returns test questions with localized text AND correct answer (Admin only).
-- Security: SECURITY DEFINER, authenticated access only (checked permission).

CREATE OR REPLACE FUNCTION public.get_test_questions_admin_localized(
  p_locale TEXT DEFAULT 'en',
  p_test_type TEXT DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_locale TEXT;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;

  -- Normalize locale
  v_locale := CASE
    WHEN p_locale IN ('cs', 'de', 'en', 'fr', 'ru', 'th') THEN p_locale
    ELSE 'en'
  END;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', tq.id,
      'test_type', tq.test_type,
      'question_order', tq.question_order,
      -- Fetch translated values
      'question', public.get_translation_value_with_fallback(
        tq.question_key, 'tests', v_locale, 'en', NULL
      ),
      'option_a', public.get_translation_value_with_fallback(
        tq.option_a_key, 'tests', v_locale, 'en', NULL
      ),
      'option_b', public.get_translation_value_with_fallback(
        tq.option_b_key, 'tests', v_locale, 'en', NULL
      ),
      'option_c', CASE WHEN tq.option_c_key IS NOT NULL THEN
        public.get_translation_value_with_fallback(
          tq.option_c_key, 'tests', v_locale, 'en', NULL
        )
      ELSE NULL END,
      'option_d', CASE WHEN tq.option_d_key IS NOT NULL THEN
        public.get_translation_value_with_fallback(
          tq.option_d_key, 'tests', v_locale, 'en', NULL
        )
      ELSE NULL END,
      -- Include correct answer
      'correct_answer', tq.correct_answer,
           -- Include keys for reference
      'question_key', tq.question_key,
      'option_a_key', tq.option_a_key,
      'option_b_key', tq.option_b_key,
      'option_c_key', tq.option_c_key,
      'option_d_key', tq.option_d_key,
      'points', tq.points,
      'is_active', tq.is_active,
      'created_at', tq.created_at,
      'updated_at', tq.updated_at
    ) ORDER BY tq.question_order
  )
  INTO v_result
  FROM test_questions tq
  WHERE (p_test_type IS NULL OR tq.test_type = p_test_type);

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_test_questions_admin_localized(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_test_questions_admin_localized(TEXT, TEXT) TO authenticated;
