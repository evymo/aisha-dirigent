-- Function: public.get_archive_document_by_slug
-- Description: Returns single archive document by slug. Uses _key columns for localized fields.
-- Security: SECURITY DEFINER - public archive documents.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_archive_document_by_slug(p_slug text)
 RETURNS TABLE(id uuid, slug text, title text, title_key text, description text, description_key text, content text, document_type text, year integer, decade text, place text, facility text, preparation text, people text[], keywords text[], provenance_badge text, scan_url text, transcript_url text, storage_path text, source_publication text, original_language text, page_count integer, is_featured boolean, is_download_public boolean, is_public boolean, summary_key text, editorial_note text, editorial_note_key text, what_you_are_looking_at text, what_you_are_looking_at_key text, standards_context text, standards_context_key text, related_documents text[], parent_document_id uuid, version text, version_date date, version_notes text, is_current_version boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    ad.id,
    ad.slug,
    ad.title,
    COALESCE(ad.title_key, '') AS title_key,
    ad.description,
    COALESCE(ad.description_key, '') AS description_key,
    ad.content,
    ad.document_type,
    ad.year,
    ad.decade,
    ad.place,
    ad.facility,
    ad.preparation,
    ad.people,
    ad.keywords,
    ad.provenance_badge,
    (CASE WHEN (ad.is_public IS TRUE OR auth.role() = 'authenticated') THEN ad.scan_url ELSE NULL END),
    (CASE WHEN (ad.is_public IS TRUE OR auth.role() = 'authenticated') THEN ad.transcript_url ELSE NULL END),
    (CASE WHEN (ad.is_download_public IS TRUE OR auth.role() = 'authenticated') THEN ad.storage_path ELSE NULL END),
    ad.source_publication,
    ad.original_language,
    ad.page_count,
    ad.is_featured,
    ad.is_download_public,
    COALESCE(ad.is_public, false),
    COALESCE(ad.summary_key, '') AS summary_key,
    ad.editorial_note,
    COALESCE(ad.editorial_note_key, '') AS editorial_note_key,
    ad.what_you_are_looking_at,
    COALESCE(ad.what_you_are_looking_at_key, '') AS what_you_are_looking_at_key,
    ad.standards_context,
    COALESCE(ad.standards_context_key, '') AS standards_context_key,
    ad.related_documents::text[],
    ad.parent_document_id,
    ad.version,
    ad.version_date::date,
    ad.version_notes,
    ad.is_current_version,
    ad.created_at,
    ad.updated_at
  FROM archive_documents ad
  WHERE ad.slug = p_slug;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_archive_document_by_slug(p_slug text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archive_document_by_slug(p_slug text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_archive_document_by_slug(p_slug text) TO authenticated;
