-- Function: get_test_questions_localized
-- Purpose: Returns test questions with localized text using translation keys only (no _cs/_en fallback).
-- Security: SECURITY DEFINER, public access.

CREATE OR REPLACE FUNCTION public.get_test_questions_localized(
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
  -- ⛔ NÁROK, NE JEN DOSTUPNOST (naměřeno 2026-09-12 diferenciální sondou).
  -- Tahle funkce vydává `correct_answer` — klíč správných odpovědí
  -- certifikačního testu — a směl ji volat i ANONYM. Zamýšlený rozpad ukazují
  -- sourozenci v témže adresáři: `get_test_questions_public_localized` vydá
  -- TYTÉŽ otázky BEZ odpovědí (a jen tu volá appka, viz useTestQuestions.ts),
  -- `get_test_questions_admin_localized` vydá odpovědi a nárok hlídá. Tahle
  -- varianta nesla admin obsah bez admin stráže — díra, ne rozhodnutí.
  IF NOT (public.is_admin_or_staff() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;

  v_locale := CASE
    WHEN p_locale IN ('cs', 'de', 'en', 'fr', 'ru', 'th') THEN p_locale
    ELSE 'en'
  END;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', tq.id,
      'test_type', tq.test_type,
      'question_order', tq.question_order,
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
      'correct_answer', tq.correct_answer,
      'points', tq.points,
      'is_active', tq.is_active
    ) ORDER BY tq.question_order
  )
  INTO v_result
  FROM test_questions tq
  WHERE tq.is_active = true
    AND (p_test_type IS NULL OR tq.test_type = p_test_type);

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$;

-- Permissions
-- `anon` tu ZÁMĚRNĚ není: funkce vydává klíč správných odpovědí. Veřejný web
-- má `get_test_questions_public_localized`, která odpovědi nenese.
REVOKE ALL ON FUNCTION public.get_test_questions_localized(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_test_questions_localized(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_test_questions_localized(TEXT, TEXT) TO service_role;
