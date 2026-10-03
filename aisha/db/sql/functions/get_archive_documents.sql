-- Function: public.get_archive_documents
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:53.143Z

CREATE OR REPLACE FUNCTION public.get_archive_documents(p_decade text DEFAULT NULL::text, p_document_type text DEFAULT NULL::text, p_preparation text DEFAULT NULL::text, p_keywords text[] DEFAULT NULL::text[], p_search_query text DEFAULT NULL::text)
 RETURNS TABLE(content text, created_at timestamptz, decade text, description text, description_key text, document_type text, editorial_note text, editorial_note_key text, facility text, id uuid, is_current_version boolean, is_download_public boolean, is_featured boolean, is_public boolean, keywords text[], original_language text, page_count integer, parent_document_id uuid, people text[], place text, preparation text, provenance_badge text, related_documents text[], scan_url text, slug text, source_publication text, standards_context text, standards_context_key text, storage_path text, summary_key text, title text, title_key text, transcript_url text, updated_at timestamptz, version text, version_date date, version_notes text, what_you_are_looking_at text, what_you_are_looking_at_key text, year integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(ad.content, '') AS content,
    ad.created_at,
    COALESCE(ad.decade, '') AS decade,
    COALESCE(ad.description, '') AS description,
    COALESCE(ad.description_key, '') AS description_key,
    ad.document_type,
    COALESCE(ad.editorial_note, '') AS editorial_note,
    COALESCE(ad.editorial_note_key, '') AS editorial_note_key,
    COALESCE(ad.facility, '') AS facility,
    ad.id,
    COALESCE(ad.is_current_version, true) AS is_current_version,
    COALESCE(ad.is_download_public, false) AS is_download_public,
    COALESCE(ad.is_featured, false) AS is_featured,
    COALESCE(ad.is_public, false) AS is_public,
    ad.keywords,
    COALESCE(ad.original_language, '') AS original_language,
    ad.page_count,
    ad.parent_document_id,
    ad.people,
    COALESCE(ad.place, '') AS place,
    COALESCE(ad.preparation, '') AS preparation,
    ad.provenance_badge,
    (SELECT array_agg(rd::text) FROM unnest(ad.related_documents) rd) AS related_documents,
    (CASE WHEN (ad.is_public IS TRUE OR auth.role() = 'authenticated') THEN COALESCE(ad.scan_url, '') ELSE NULL END) AS scan_url,
    ad.slug,
    COALESCE(ad.source_publication, '') AS source_publication,
    COALESCE(ad.standards_context, '') AS standards_context,
    COALESCE(ad.standards_context_key, '') AS standards_context_key,
    (CASE WHEN (ad.is_download_public IS TRUE OR auth.role() = 'authenticated') THEN COALESCE(ad.storage_path, '') ELSE NULL END) AS storage_path,
    COALESCE(ad.summary_key, '') AS summary_key,
    ad.title,
    COALESCE(ad.title_key, '') AS title_key,
    (CASE WHEN (ad.is_public IS TRUE OR auth.role() = 'authenticated') THEN COALESCE(ad.transcript_url, '') ELSE NULL END) AS transcript_url,
    ad.updated_at,
    COALESCE(ad.version, '') AS version,
    ad.version_date::text AS version_date,
    COALESCE(ad.version_notes, '') AS version_notes,
    COALESCE(ad.what_you_are_looking_at, '') AS what_you_are_looking_at,
    COALESCE(ad.what_you_are_looking_at_key, '') AS what_you_are_looking_at_key,
    ad.year
  FROM archive_documents ad
  WHERE
    (p_decade IS NULL OR ad.decade = p_decade)
    AND (p_document_type IS NULL OR ad.document_type = p_document_type)
    AND (p_preparation IS NULL OR ad.preparation = p_preparation)
    AND (p_keywords IS NULL OR ad.keywords && p_keywords)
    AND (p_search_query IS NULL OR
         ad.title ILIKE '%' || p_search_query || '%' OR
         ad.description ILIKE '%' || p_search_query || '%' OR
         ad.content ILIKE '%' || p_search_query || '%')
  ORDER BY ad.year DESC NULLS LAST, ad.title ASC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_archive_documents(text, text, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archive_documents(text, text, text, text[], text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_archive_documents(text, text, text, text[], text) TO authenticated;

