-- Function: public.get_question_blocks_by_context_type
-- Arguments: p_context_type text, p_locale text
-- Description: Returns question blocks by context_type, delegating to get_question_blocks_for_context.
-- Replaces the frontend CONTEXT_BLOCK_CODES hardcoded mapping.
-- Security: SECURITY DEFINER - public read-only questionnaire templates.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_question_blocks_by_context_type(
  p_context_type text,
  p_locale text DEFAULT 'en'
)
RETURNS TABLE(
  block_code text,
  config jsonb,
  display_order integer,
  id uuid,
  is_active boolean,
  is_required boolean,
  question_type text,
  text_key text,
  translated_text text,
  translated_description text,
  option_translations jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_block_codes text[];
BEGIN
  -- Resolve block codes from context_type
  SELECT array_agg(qb.code ORDER BY qb.display_order)
  INTO v_block_codes
  FROM question_blocks qb
  WHERE qb.context_type = p_context_type
    AND qb.is_active = true;

  IF v_block_codes IS NULL OR array_length(v_block_codes, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Delegate to existing function that handles all translation resolution
  RETURN QUERY
  SELECT
    q.block_code,
    q.config,
    q.display_order,
    q.id,
    q.is_active,
    q.is_required,
    q.question_type,
    q.text_key,
    q.translated_text,
    q.translated_description,
    q.option_translations
  FROM public.get_question_blocks_for_context(v_block_codes, p_locale) q;
END;
$$;

REVOKE ALL ON FUNCTION public.get_question_blocks_by_context_type(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_blocks_by_context_type(text, text) TO authenticated;
