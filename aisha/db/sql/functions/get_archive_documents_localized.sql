-- Function: public.get_archive_documents_localized
-- Description: Returns archive documents with localized fields via translation keys.
-- Security: SECURITY DEFINER - public archive access.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_archive_documents_localized(
  p_locale text DEFAULT 'en',
  p_decade text DEFAULT NULL,
  p_document_type text DEFAULT NULL,
  p_preparation text DEFAULT NULL,
  p_keywords text[] DEFAULT NULL,
  p_search_query text DEFAULT NULL,
  p_parent_document_id uuid DEFAULT NULL,
  p_is_featured boolean DEFAULT NULL,
  p_limit integer DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  slug text,
  title text,
  summary text,
  description text,
  editorial_note text,
  what_you_are_looking_at text,
  standards_context text,
  content text,
  document_type text,
  year integer,
  decade text,
  place text,
  facility text,
  preparation text,
  people text[],
  keywords text[],
  provenance_badge text,
  scan_url text,
  transcript_url text,
  storage_path text,
  source_publication text,
  original_language text,
  page_count integer,
  is_featured boolean,
  is_download_public boolean,
  is_public boolean,
  related_documents text[],
  parent_document_id uuid,
  version text,
  version_date date,
  version_notes text,
  is_current_version boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_member_access boolean := false;
BEGIN
  IF auth.role() = 'authenticated' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.consents c
      WHERE c.user_id = auth.uid()
        AND c.consent_type = 'data_processing'::public.consent_type
        AND c.granted = true
        AND c.revoked_at IS NULL
    ) INTO v_has_member_access;
  END IF;

  RETURN QUERY
  SELECT
    ad.id,
    ad.slug,
    public.get_translation_value_with_fallback(
      ad.title_key, 'archive', p_locale, 'en', ad.title
    ) AS title,
    public.get_translation_value_with_fallback(
      ad.summary_key, 'archive', p_locale, 'en', NULL
    ) AS summary,
    public.get_translation_value_with_fallback(
      ad.description_key, 'archive', p_locale, 'en', ad.description
    ) AS description,
    public.get_translation_value_with_fallback(
      ad.editorial_note_key, 'archive', p_locale, 'en', ad.editorial_note
    ) AS editorial_note,
    public.get_translation_value_with_fallback(
      ad.what_you_are_looking_at_key, 'archive', p_locale, 'en', ad.what_you_are_looking_at
    ) AS what_you_are_looking_at,
    public.get_translation_value_with_fallback(
      ad.standards_context_key, 'archive', p_locale, 'en', ad.standards_context
    ) AS standards_context,
    COALESCE(ad.content, '') AS content,
    ad.document_type,
    ad.year,
    COALESCE(ad.decade, '') AS decade,
    COALESCE(ad.place, '') AS place,
    COALESCE(ad.facility, '') AS facility,
    COALESCE(ad.preparation, '') AS preparation,
    ad.people,
    ad.keywords,
    ad.provenance_badge,
    (CASE WHEN (ad.is_public IS TRUE OR v_has_member_access) THEN COALESCE(ad.scan_url, '') ELSE NULL END) AS scan_url,
    (CASE WHEN (ad.is_public IS TRUE OR v_has_member_access) THEN COALESCE(ad.transcript_url, '') ELSE NULL END) AS transcript_url,
    (CASE WHEN (ad.is_download_public IS TRUE OR v_has_member_access) THEN COALESCE(ad.storage_path, '') ELSE NULL END) AS storage_path,
    COALESCE(ad.source_publication, '') AS source_publication,
    COALESCE(ad.original_language, '') AS original_language,
    ad.page_count,
    COALESCE(ad.is_featured, false) AS is_featured,
    COALESCE(ad.is_download_public, false) AS is_download_public,
    COALESCE(ad.is_public, false) AS is_public,
    ad.related_documents,
    ad.parent_document_id,
    COALESCE(ad.version, '') AS version,
    ad.version_date::text AS version_date,
    COALESCE(ad.version_notes, '') AS version_notes,
    COALESCE(ad.is_current_version, true) AS is_current_version,
    ad.created_at,
    ad.updated_at
  FROM archive_documents ad
  WHERE
    (COALESCE(ad.is_public, false) OR v_has_member_access)
    AND
    (p_decade IS NULL OR ad.decade = p_decade)
    AND (p_document_type IS NULL OR ad.document_type = p_document_type)
    AND (p_preparation IS NULL OR ad.preparation = p_preparation)
    AND (p_keywords IS NULL OR ad.keywords && p_keywords)
    AND (p_parent_document_id IS NULL OR ad.parent_document_id = p_parent_document_id)
    AND (p_is_featured IS NULL OR ad.is_featured = p_is_featured)
    AND (p_search_query IS NULL OR
         ad.title ILIKE '%' || p_search_query || '%' OR
         ad.description ILIKE '%' || p_search_query || '%' OR
         ad.content ILIKE '%' || p_search_query || '%')
  ORDER BY ad.year DESC NULLS LAST, ad.title ASC
  LIMIT p_limit;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_archive_documents_localized(text, text, text, text, text[], text, uuid, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archive_documents_localized(text, text, text, text, text[], text, uuid, boolean, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_archive_documents_localized(text, text, text, text, text[], text, uuid, boolean, integer) TO authenticated;
