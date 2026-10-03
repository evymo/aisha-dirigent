-- Function: public.get_combined_study_consents
-- Arguments: p_study_id uuid, p_locale text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:42+01:00

CREATE OR REPLACE FUNCTION public.get_combined_study_consents(p_study_id uuid, p_locale text DEFAULT 'en'::text)
 RETURNS TABLE(id uuid, consent_key text, title text, description text, checkbox_label text, is_required boolean, display_order integer, document_url text, study_code text, is_umbrella boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_study_id UUID;
  v_locale TEXT;
BEGIN
  v_locale := lower(split_part(coalesce(p_locale, 'en'), '-', 1));

  -- Get parent study ID
  SELECT s.parent_study_id INTO v_parent_study_id
  FROM studies s
  WHERE s.id = p_study_id
  LIMIT 1;
  
  -- Return combined consents: umbrella first, then child study
  -- Use DISTINCT ON to deduplicate by consent_key, preferring child study entries.
  RETURN QUERY
  WITH all_consents AS (
    -- Umbrella study consents (if this study has a parent)
    SELECT 
      sci.id,
      sci.consent_key,
      public.get_translation_value_with_fallback(sci.title_key, 'consents', v_locale, 'en', NULL) as title,
      public.get_translation_value_with_fallback(sci.description_key, 'consents', v_locale, 'en', NULL) as description,
      public.get_translation_value_with_fallback(sci.checkbox_label_key, 'consents', v_locale, 'en', NULL) as checkbox_label,
      sci.is_required,
      sci.display_order,
      sci.document_url,
      s.code as study_code,
      true as is_umbrella,
      1 as priority -- Lower priority for umbrella
    FROM study_consent_items sci
    JOIN studies s ON s.id = sci.study_id
    WHERE sci.study_id = v_parent_study_id
      AND sci.is_active = true
      AND v_parent_study_id IS NOT NULL
    
    UNION ALL
    
    -- Child study consents (current study)
    SELECT 
      sci.id,
      sci.consent_key,
      public.get_translation_value_with_fallback(sci.title_key, 'consents', v_locale, 'en', NULL) as title,
      public.get_translation_value_with_fallback(sci.description_key, 'consents', v_locale, 'en', NULL) as description,
      public.get_translation_value_with_fallback(sci.checkbox_label_key, 'consents', v_locale, 'en', NULL) as checkbox_label,
      sci.is_required,
      sci.display_order,
      sci.document_url,
      s.code as study_code,
      false as is_umbrella,
      2 as priority -- Higher priority for child study
    FROM study_consent_items sci
    JOIN studies s ON s.id = sci.study_id
    WHERE sci.study_id = p_study_id
      AND sci.is_active = true
  )
  SELECT DISTINCT ON (ac.consent_key)
    ac.id,
    ac.consent_key,
    ac.title,
    ac.description,
    ac.checkbox_label,
    ac.is_required,
    ac.display_order,
    ac.document_url,
    ac.study_code,
    ac.is_umbrella
  FROM all_consents ac
  ORDER BY ac.consent_key, ac.priority DESC, ac.display_order;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_combined_study_consents(p_study_id uuid, p_locale text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_combined_study_consents(p_study_id uuid, p_locale text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_combined_study_consents(p_study_id uuid, p_locale text) TO authenticated;
