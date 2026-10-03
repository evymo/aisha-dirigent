-- Function: public.get_question_blocks_for_context
-- Arguments: p_block_codes text[], p_locale text
-- Description: Returns question blocks for questionnaires. Public template data.
-- Security: SECURITY DEFINER - public read-only questionnaire templates.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_question_blocks_for_context(p_block_codes text[], p_locale text DEFAULT 'en'::text)
 RETURNS TABLE(block_code text, config jsonb, display_order integer, id uuid, is_active boolean, is_required boolean, question_type text, text_key text, translated_text text, translated_description text, option_translations jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_all_label_keys text[];
  v_translations_map jsonb := '{}'::jsonb;
  v_fallback_map jsonb := '{}'::jsonb;
BEGIN
  -- First, collect all label_key values from configs of requested blocks
  SELECT array_agg(DISTINCT label_key)
  INTO v_all_label_keys
  FROM (
    -- Extract label_key from tags options
    SELECT opt->>'label_key' AS label_key
    FROM question_blocks qb,
         jsonb_array_elements(qb.config->'options') AS opt
    WHERE qb.code = ANY(p_block_codes)
      AND qb.is_active = true
      AND qb.question_type IN ('tags', 'select', 'radio', 'checkbox')
      AND opt->>'label_key' IS NOT NULL
    
    UNION
    
    -- Extract description_key from tags options
    SELECT opt->>'description_key' AS label_key
    FROM question_blocks qb,
         jsonb_array_elements(qb.config->'options') AS opt
    WHERE qb.code = ANY(p_block_codes)
      AND qb.is_active = true
      AND qb.question_type IN ('tags', 'select', 'radio', 'checkbox')
      AND opt->>'description_key' IS NOT NULL
    
    UNION
    
    -- Extract label_key from feeling presets
    SELECT preset->>'label_key' AS label_key
    FROM question_blocks qb,
         jsonb_array_elements(qb.config->'presets') AS preset
    WHERE qb.code = ANY(p_block_codes)
      AND qb.is_active = true
      AND qb.question_type = 'feeling_preset'
      AND preset->>'label_key' IS NOT NULL
    
    UNION
    
    -- Extract description_key from feeling presets
    SELECT preset->>'description_key' AS label_key
    FROM question_blocks qb,
         jsonb_array_elements(qb.config->'presets') AS preset
    WHERE qb.code = ANY(p_block_codes)
      AND qb.is_active = true
      AND qb.question_type = 'feeling_preset'
      AND preset->>'description_key' IS NOT NULL

    UNION

    -- Extract lowLabel_key, highLabel_key, midLabel_key from scale configs
    SELECT unnest(ARRAY[
      qb.config->>'lowLabel_key',
      qb.config->>'highLabel_key',
      qb.config->>'midLabel_key'
    ]) AS label_key
    FROM question_blocks qb
    WHERE qb.code = ANY(p_block_codes)
      AND qb.is_active = true
      AND qb.question_type = 'scale'

    UNION

    -- Extract trueLabel_key, falseLabel_key from boolean configs
    SELECT unnest(ARRAY[
      qb.config->>'trueLabel_key',
      qb.config->>'falseLabel_key'
    ]) AS label_key
    FROM question_blocks qb
    WHERE qb.code = ANY(p_block_codes)
      AND qb.is_active = true
      AND qb.question_type = 'boolean'

    UNION

    -- Extract placeholder_key from text/date/textarea configs
    SELECT qb.config->>'placeholder_key' AS label_key
    FROM question_blocks qb
    WHERE qb.code = ANY(p_block_codes)
      AND qb.is_active = true
      AND qb.question_type IN ('text', 'date', 'textarea')
      AND qb.config->>'placeholder_key' IS NOT NULL

    UNION

    -- Extract unit_key from number configs
    SELECT qb.config->>'unit_key' AS label_key
    FROM question_blocks qb
    WHERE qb.code = ANY(p_block_codes)
      AND qb.is_active = true
      AND qb.question_type = 'number'
      AND qb.config->>'unit_key' IS NOT NULL

    UNION

    -- Extract label_key from scale labels array (WOMAC scale point labels)
    SELECT lbl->>'label_key' AS label_key
    FROM question_blocks qb,
         jsonb_array_elements(qb.config->'labels') AS lbl
    WHERE qb.code = ANY(p_block_codes)
      AND qb.is_active = true
      AND qb.question_type = 'scale'
      AND qb.config ? 'labels'
      AND lbl->>'label_key' IS NOT NULL
  ) AS keys
  WHERE label_key IS NOT NULL;

  -- Fetch translations for all collected keys
  IF v_all_label_keys IS NOT NULL AND array_length(v_all_label_keys, 1) > 0 THEN
    -- First get English fallback translations
    SELECT jsonb_object_agg(t.key, t.value)
    INTO v_fallback_map
    FROM translations t
    WHERE t.key = ANY(v_all_label_keys)
      AND t.locale = 'en'
      AND t.namespace = 'questionnaires';
    
    -- Then get requested locale translations (if not English)
    IF p_locale != 'en' THEN
      SELECT jsonb_object_agg(t.key, t.value)
      INTO v_translations_map
      FROM translations t
      WHERE t.key = ANY(v_all_label_keys)
        AND t.locale = p_locale
        AND t.namespace = 'questionnaires';
    END IF;
    
    -- Merge: locale translations override English fallback
    v_translations_map := COALESCE(v_fallback_map, '{}'::jsonb) || COALESCE(v_translations_map, '{}'::jsonb);
  END IF;

  -- Return blocks with translations (using standard helper with English fallback)
  RETURN QUERY
  SELECT 
    qb.code AS block_code,
    qb.config,
    qb.display_order,
    qb.id,
    qb.is_active,
    qb.is_required_default AS is_required,
    qb.question_type,
    qb.text_key,
    public.get_translation_value_with_fallback(
      qb.text_key, 'questionnaires', p_locale, 'en', qb.text_key
    ) AS translated_text,
    public.get_translation_value_with_fallback(
      qb.text_key || '.description', 'questionnaires', p_locale, 'en', ''
    ) AS translated_description,
    COALESCE(v_translations_map, '{}'::jsonb) AS option_translations
  FROM question_blocks qb
  WHERE qb.code = ANY(p_block_codes)
    AND qb.is_active = true
  ORDER BY qb.display_order;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_question_blocks_for_context(p_block_codes text[], p_locale text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_blocks_for_context(p_block_codes text[], p_locale text) TO public;
