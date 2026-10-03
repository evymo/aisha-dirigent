-- Function: public.get_my_pending_consents
-- Arguments: p_locale text
-- Description: Returns the caller's OUTSTANDING (not-yet-accepted, in-window) consent
--   requirements across their active study registrations, localized. This is the
--   first-class "what do I still need to sign" reader that previously did not exist —
--   the client had to diff get_(combined_)consent_requirements_localized against
--   get_my_consents. Backs the member charter-signing surface.
-- Security: SECURITY DEFINER, authenticated only (subject is always the caller).

CREATE OR REPLACE FUNCTION public.get_my_pending_consents(p_locale text DEFAULT 'en')
 RETURNS TABLE(
   id uuid,
   study_id uuid,
   study_name text,
   consent_template_id uuid,
   template_key text,
   title text,
   content text,
   version text,
   is_required boolean,
   requires_signature boolean
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    scr.id,
    scr.study_id,
    s.name AS study_name,
    scr.consent_template_id,
    COALESCE(ct.template_key, ct.code, '') AS template_key,
    public.get_translation_value_with_fallback(
      ct.title_key, 'consents', p_locale,
      COALESCE(NULLIF(ct.base_locale, ''), 'en'),
      COALESCE(ct.template_key, ct.code, '')
    ) AS title,
    public.get_translation_value_with_fallback(
      ct.content_key, 'consents', p_locale,
      COALESCE(NULLIF(ct.base_locale, ''), 'en'),
      ''
    ) AS content,
    COALESCE(ct.version, '1.0') AS version,
    scr.is_required,
    COALESCE(ct.requires_signature, false) AS requires_signature
  FROM public.study_registrations sr
  JOIN public.study_consent_requirements scr
    ON scr.study_id = sr.study_id AND COALESCE(scr.is_active, true) = true
  JOIN public.consent_templates ct
    ON ct.id = scr.consent_template_id AND COALESCE(ct.is_active, true) = true
  JOIN public.studies s ON s.id = scr.study_id
  -- Already accepted (and not revoked) for the pinned major version → excluded.
  LEFT JOIN public.study_consent_acceptances sca
    ON sca.user_id = sr.user_id
   AND sca.study_id = scr.study_id
   AND sca.consent_template_id = scr.consent_template_id
   AND sca.consent_template_version = floor(scr.consent_template_version::numeric)::integer
   AND sca.revoked_at IS NULL
  WHERE sr.user_id = v_user_id
    AND sr.status IN ('enrolled', 'active')
    AND sca.id IS NULL
    AND (scr.valid_from IS NULL OR now() >= scr.valid_from)
    AND (scr.valid_until IS NULL OR now() <= scr.valid_until)
  ORDER BY scr.sort_order, COALESCE(ct.template_key, ct.code, '');
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_pending_consents(p_locale text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_pending_consents(p_locale text) TO authenticated;
