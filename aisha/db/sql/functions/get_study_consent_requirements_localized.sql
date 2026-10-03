-- Function: public.get_study_consent_requirements_localized
-- Arguments: p_study_id uuid, p_locale text
-- Description: Returns localized consent requirements for a study.
--              This function is PUBLIC (no auth required) because consent
--              requirements must be visible during registration before signup.
-- Security: SECURITY DEFINER with search_path.
-- Extracted: 2026-01-08T18:27:33+01:00

CREATE OR REPLACE FUNCTION public.get_study_consent_requirements_localized(p_study_id uuid, p_locale text)
 RETURNS TABLE(id uuid, consent_template_id uuid, is_required boolean, sort_order integer, template_key text, title text, content text, version text, requires_signature boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- No auth check - consent requirements are public information
  -- needed for registration flow before user signup

  RETURN QUERY
  SELECT
    scr.id,
    scr.consent_template_id,
    scr.is_required,
    scr.sort_order,
    COALESCE(ct.template_key, ct.code, '') AS template_key,
    -- Localized title from translation key with fallback to template key
    public.get_translation_value_with_fallback(
      ct.title_key,
      'consents',
      p_locale,
      COALESCE(NULLIF(ct.base_locale, ''), 'en'),
      COALESCE(ct.template_key, ct.code, '')
    ) AS title,
    -- Localized content from translation key with empty fallback
    public.get_translation_value_with_fallback(
      ct.content_key,
      'consents',
      p_locale,
      COALESCE(NULLIF(ct.base_locale, ''), 'en'),
      ''
    ) AS content,
    COALESCE(ct.version, '1.0') AS version,
    COALESCE(ct.requires_signature, false) AS requires_signature
  FROM public.study_consent_requirements scr
  JOIN public.consent_templates ct ON ct.id = scr.consent_template_id
  WHERE scr.study_id = p_study_id
    AND COALESCE(scr.is_active, true) = true
    AND COALESCE(ct.is_active, true) = true
  ORDER BY scr.sort_order, COALESCE(ct.template_key, ct.code, '');
END;
$function$
;

-- Permissions: grant to both anon (for registration) and authenticated
REVOKE ALL ON FUNCTION public.get_study_consent_requirements_localized(p_study_id uuid, p_locale text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_consent_requirements_localized(p_study_id uuid, p_locale text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_study_consent_requirements_localized(p_study_id uuid, p_locale text) TO authenticated;
