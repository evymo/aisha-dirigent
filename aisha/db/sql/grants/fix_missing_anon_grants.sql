-- Fix missing GRANT TO anon for public RPC functions
-- Run this on production to fix web access for anonymous users
-- Date: 2025-02-02

-- Questionnaire blocks - needed for public questionnaires
GRANT EXECUTE ON FUNCTION public.get_questionnaire_blocks_localized(p_questionnaire_code text, p_locale text) TO anon;

-- Test questions - veřejný web používá variantu BEZ správných odpovědí.
-- 2026-09-12: `get_test_questions_localized` vydává `correct_answer`; grant pro
-- anon tím dával klíč k certifikačnímu testu komukoli i bez účtu. Odebráno.
GRANT EXECUTE ON FUNCTION public.get_test_questions_public_localized(TEXT, TEXT) TO anon;
REVOKE EXECUTE ON FUNCTION public.get_test_questions_localized(TEXT, TEXT) FROM anon;

-- Translations - needed for localized public content
GRANT EXECUTE ON FUNCTION public.get_translations(p_namespace text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_translations_by_key(p_key text, p_namespace text) TO anon;

-- Verify grants
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name IN (
      'get_questionnaire_blocks_localized',
      'get_test_questions_localized',
      'get_translations',
      'get_translations_by_key'
    )
    AND grantee = 'anon';
  
  RAISE NOTICE 'Verified % anon grants on public functions', v_count;
  
  IF v_count < 4 THEN
    RAISE WARNING 'Expected 4 grants, found only %', v_count;
  END IF;
END $$;
