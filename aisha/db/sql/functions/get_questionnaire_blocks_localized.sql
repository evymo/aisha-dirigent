-- Function: public.get_questionnaire_blocks_localized
-- Arguments: p_questionnaire_code text, p_locale text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:27+01:00

CREATE OR REPLACE FUNCTION public.get_questionnaire_blocks_localized(p_questionnaire_code text, p_locale text DEFAULT 'en'::text)
 RETURNS TABLE(id uuid, block_code text, question_type text, translated_text text, translated_description text, config jsonb, is_required boolean, display_order integer, step_number integer, section_key text, option_translations jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_questionnaire_id UUID;
BEGIN
  -- Resolve by code (web passes the slug, e.g. 'ONBOARDING') OR by id (both mobile
  -- detail routes only ever hold the questionnaire UUID). Codes are slugs and never
  -- look like a UUID, so the two can't collide; accepting both here fixes the mobile
  -- "form always empty" bug without threading a code through every caller/route.
  SELECT q.id INTO v_questionnaire_id
  FROM questionnaires q
  WHERE (q.code = p_questionnaire_code OR q.id::text = p_questionnaire_code)
    AND q.is_active = true
  LIMIT 1;
  
  IF v_questionnaire_id IS NULL THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    qb.id,
    b.code as block_code,
    b.question_type,
    -- Get translated text with fallback: requested locale -> en (terminal) -> key
    COALESCE(
      (SELECT t.value FROM translations t WHERE t.key = b.text_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
      (SELECT t.value FROM translations t WHERE t.key = b.text_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
      b.text_key
    ) as translated_text,
    -- Get translated description with same fallback
    COALESCE(
      (SELECT t.value FROM translations t WHERE t.key = b.description_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
      (SELECT t.value FROM translations t WHERE t.key = b.description_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
      b.description_key
    ) as translated_description,
    b.config,
    qb.is_required,
    qb.display_order,
    qb.step_number,
    qb.section_key,
    -- Get option translations + config label translations as JSONB
    -- Merge: tag/select/radio option values + scale/boolean/preset/text/number/date label_key values
    (
      SELECT COALESCE(opt_trans, '{}'::jsonb) || COALESCE(label_trans, '{}'::jsonb)
      FROM
      -- 1. Tag/select/radio option translations (key = option value, value = translated label)
      (
        SELECT jsonb_object_agg(
          opt_value,
          COALESCE(
            (SELECT t.value FROM translations t WHERE t.key = 'questionnaires.blocks.' || b.code || '.options.' || opt_value AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
            (SELECT t.value FROM translations t WHERE t.key = 'questionnaires.blocks.' || b.code || '.options.' || opt_value AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
            opt_value
          )
        ) AS opt_trans
        FROM (
          SELECT 
            CASE 
              WHEN jsonb_typeof(opt) = 'object' THEN opt->>'value'
              ELSE opt #>> '{}'
            END as opt_value
          FROM jsonb_array_elements(COALESCE(b.config->'options', '[]'::jsonb)) as opt
        ) as opts
        WHERE opt_value IS NOT NULL
      ) AS ot,
      -- 2. Config label_key translations (key = translation_key, value = translated label)
      -- Resolves: scale lowLabel_key/highLabel_key/midLabel_key, boolean trueLabel_key/falseLabel_key,
      -- feeling_preset label_key/description_key, text/date placeholder_key, number unit_key
      (
        SELECT jsonb_object_agg(
          label_key,
          COALESCE(
            (SELECT t.value FROM translations t WHERE t.key = label_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
            (SELECT t.value FROM translations t WHERE t.key = label_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
            label_key
          )
        ) AS label_trans
        FROM (
          -- Scale label keys
          SELECT unnest(ARRAY[
            b.config->>'lowLabel_key',
            b.config->>'highLabel_key',
            b.config->>'midLabel_key'
          ]) AS label_key
          WHERE b.question_type = 'scale'
          UNION
          -- Boolean label keys
          SELECT unnest(ARRAY[
            b.config->>'trueLabel_key',
            b.config->>'falseLabel_key'
          ]) AS label_key
          WHERE b.question_type = 'boolean'
          UNION
          -- Feeling preset label keys
          SELECT preset->>'label_key' AS label_key
          FROM jsonb_array_elements(COALESCE(b.config->'presets', '[]'::jsonb)) AS preset
          WHERE b.question_type = 'feeling_preset'
            AND preset->>'label_key' IS NOT NULL
          UNION
          -- Text/date/textarea placeholder keys
          SELECT b.config->>'placeholder_key' AS label_key
          WHERE b.question_type IN ('text', 'date', 'textarea')
            AND b.config->>'placeholder_key' IS NOT NULL
          UNION
          -- Number unit keys
          SELECT b.config->>'unit_key' AS label_key
          WHERE b.question_type = 'number'
            AND b.config->>'unit_key' IS NOT NULL
          UNION
          -- Scale point labels (labels array with label_key)
          SELECT lbl->>'label_key' AS label_key
          FROM jsonb_array_elements(COALESCE(b.config->'labels', '[]'::jsonb)) AS lbl
          WHERE b.question_type = 'scale'
            AND lbl->>'label_key' IS NOT NULL
        ) AS keys
        WHERE label_key IS NOT NULL
      ) AS lt
    ) as option_translations
  FROM questionnaire_blocks qb
  JOIN question_blocks b ON b.id = qb.block_id
  WHERE qb.questionnaire_id = v_questionnaire_id
    AND b.is_active = true
  ORDER BY qb.step_number NULLS FIRST, qb.display_order;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_questionnaire_blocks_localized(p_questionnaire_code text, p_locale text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_questionnaire_blocks_localized(p_questionnaire_code text, p_locale text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_questionnaire_blocks_localized(p_questionnaire_code text, p_locale text) TO authenticated;
