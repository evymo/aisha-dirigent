-- Function: public.get_study_consent_items_localized
-- Arguments: p_study_id uuid, p_locale text
-- Description: Returns localized consent items for a study (newer consent system).
--              This function is PUBLIC (no auth required) because consent
--              items must be visible during registration before signup.
-- Security: SECURITY DEFINER with search_path.

CREATE OR REPLACE FUNCTION public.get_study_consent_items_localized(p_study_id uuid, p_locale text DEFAULT 'en')
 RETURNS TABLE(
   id uuid,
   consent_key text,
   title text,
   description text,
   checkbox_label text,
   document_url text,
   is_required boolean,
   display_order integer
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- No auth check - consent items are public information
  -- needed for registration flow before user signup

  RETURN QUERY
  SELECT
    sci.id,
    sci.consent_key,
    -- Localized title
    public.get_translation_value_with_fallback(
      sci.title_key, 'consents', p_locale, 'en', NULL
    ) AS title,
    -- Localized description
    public.get_translation_value_with_fallback(
      sci.description_key, 'consents', p_locale, 'en', NULL
    ) AS description,
    -- Localized checkbox label
    public.get_translation_value_with_fallback(
      sci.checkbox_label_key, 'consents', p_locale, 'en', NULL
    ) AS checkbox_label,
    sci.document_url,
    sci.is_required,
    sci.display_order
  FROM public.study_consent_items sci
  WHERE sci.study_id = p_study_id
    AND COALESCE(sci.is_active, true) = true
  ORDER BY sci.display_order, sci.created_at;
END;
$function$;

-- Permissions: grant to both anon (for registration) and authenticated
REVOKE ALL ON FUNCTION public.get_study_consent_items_localized(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_consent_items_localized(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_study_consent_items_localized(uuid, text) TO authenticated;
