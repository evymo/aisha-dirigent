-- Function: public.get_archive_documents_by_slugs
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:53.015Z

CREATE OR REPLACE FUNCTION public.get_archive_documents_by_slugs(p_slugs text[])
 RETURNS TABLE(content text, created_at timestamptz, decade text, description text, description_key text, document_type text, editorial_note text, editorial_note_key text, facility text, id uuid, is_current_version boolean, is_download_public boolean, is_featured boolean, is_public boolean, keywords text[], original_language text, page_count integer, parent_document_id uuid, people text[], place text, preparation text, provenance_badge text, related_documents text[], scan_url text, slug text, source_publication text, standards_context text, standards_context_key text, storage_path text, summary_key text, title text, title_key text, transcript_url text, updated_at timestamptz, version text, version_date date, version_notes text, what_you_are_looking_at text, what_you_are_looking_at_key text, year integer)
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
    ad.content,
    ad.created_at,
    ad.decade,
    ad.description,
    COALESCE(ad.description_key, '') AS description_key,
    ad.document_type,
    ad.editorial_note,
    COALESCE(ad.editorial_note_key, '') AS editorial_note_key,
    ad.facility,
    ad.id,
    ad.is_current_version,
    COALESCE(ad.is_download_public, false),
    ad.is_featured,
    COALESCE(ad.is_public, false),
    ad.keywords,
    ad.original_language,
    ad.page_count,
    ad.parent_document_id,
    ad.people,
    ad.place,
    ad.preparation,
    ad.provenance_badge,
    ad.related_documents,
    (CASE WHEN (ad.is_public IS TRUE OR v_has_member_access) THEN ad.scan_url ELSE NULL END),
    ad.slug,
    ad.source_publication,
    ad.standards_context,
    COALESCE(ad.standards_context_key, '') AS standards_context_key,
    (CASE WHEN (ad.is_download_public IS TRUE OR v_has_member_access) THEN ad.storage_path ELSE NULL END),
    COALESCE(ad.summary_key, '') AS summary_key,
    ad.title,
    COALESCE(ad.title_key, '') AS title_key,
    (CASE WHEN (ad.is_public IS TRUE OR v_has_member_access) THEN ad.transcript_url ELSE NULL END),
    ad.updated_at,
    ad.version,
    ad.version_date,
    ad.version_notes,
    ad.what_you_are_looking_at,
    COALESCE(ad.what_you_are_looking_at_key, '') AS what_you_are_looking_at_key,
    ad.year
  FROM archive_documents ad
  WHERE ad.slug = ANY(p_slugs)
    AND (COALESCE(ad.is_public, false) OR v_has_member_access)
  ORDER BY ad.slug;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_archive_documents_by_slugs(p_slugs text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archive_documents_by_slugs(p_slugs text[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_archive_documents_by_slugs(p_slugs text[]) TO authenticated;
