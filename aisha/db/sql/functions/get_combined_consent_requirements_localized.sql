-- Function: public.get_combined_consent_requirements_localized
-- Arguments: p_study_id uuid, p_locale text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:42+01:00

CREATE OR REPLACE FUNCTION public.get_combined_consent_requirements_localized(p_study_id uuid, p_locale text DEFAULT 'en'::text)
 RETURNS TABLE(id uuid, consent_template_id uuid, is_required boolean, sort_order integer, template_key text, title text, content text, version text, requires_signature boolean, study_id uuid, study_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_study_id UUID;
  v_locale TEXT;
BEGIN
  v_locale := COALESCE(p_locale, 'en');
  
  -- Get parent study if exists
  SELECT s.parent_study_id INTO v_parent_study_id
  FROM studies s WHERE s.id = p_study_id;
  
  RETURN QUERY
  WITH all_study_ids AS (
    -- Include target study
    SELECT p_study_id AS sid
    UNION
    -- Include parent umbrella study if exists
    SELECT v_parent_study_id WHERE v_parent_study_id IS NOT NULL
  ),
  study_consents AS (
    SELECT 
      scr.id,
      scr.consent_template_id,
      scr.is_required,
      scr.sort_order,
      ct.template_key,
      public.get_translation_value_with_fallback(
        ct.title_key,
        'consents',
        v_locale,
        COALESCE(NULLIF(ct.base_locale, ''), 'en'),
        COALESCE(ct.template_key, ct.code, '')
      ) AS title,
      public.get_translation_value_with_fallback(
        ct.content_key,
        'consents',
        v_locale,
        COALESCE(NULLIF(ct.base_locale, ''), 'en'),
        ''
      ) AS content,
      ct.version,
      ct.requires_signature,
      scr.study_id,
      st.name AS study_name,
      -- Priority: umbrella first, then child
      CASE WHEN st.is_umbrella THEN 0 ELSE 1 END AS priority
    FROM study_consent_requirements scr
    JOIN consent_templates ct ON ct.id = scr.consent_template_id
    JOIN studies st ON st.id = scr.study_id
    WHERE scr.study_id IN (SELECT sid FROM all_study_ids)
      AND ct.is_active = true
  )
  SELECT DISTINCT ON (sc.template_key)
    sc.id,
    sc.consent_template_id,
    sc.is_required,
    sc.sort_order,
    sc.template_key,
    sc.title,
    sc.content,
    sc.version,
    sc.requires_signature,
    sc.study_id,
    sc.study_name
  FROM study_consents sc
  ORDER BY sc.template_key, sc.priority, sc.sort_order;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_combined_consent_requirements_localized(p_study_id uuid, p_locale text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_combined_consent_requirements_localized(p_study_id uuid, p_locale text) TO authenticated;
