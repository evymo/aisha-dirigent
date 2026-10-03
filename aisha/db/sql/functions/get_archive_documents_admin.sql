-- Function: public.get_archive_documents_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:52.890Z

CREATE OR REPLACE FUNCTION public.get_archive_documents_admin()
 RETURNS TABLE(content text, created_at timestamptz, decade text, description text, description_key text, document_type text, editorial_note text, editorial_note_key text, facility text, id uuid, is_current_version boolean, is_download_public boolean, is_featured boolean, is_public boolean, keywords text[], original_language text, page_count integer, parent_document_id uuid, people text[], place text, preparation text, provenance_badge text, related_documents text[], scan_url text, slug text, source_publication text, standards_context text, standards_context_key text, storage_path text, summary_key text, title text, title_key text, transcript_url text, updated_at timestamptz, version text, version_date date, version_notes text, what_you_are_looking_at text, what_you_are_looking_at_key text, year integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;

  INSERT INTO audit_journal (
    user_id, action_type, entity_type, area, severity, summary
  ) VALUES (
    auth.uid(), 'read'::journal_action_type, 'archive_documents_admin',
    'content'::journal_area, 'info'::journal_severity,
    'Admin viewed archive documents'
  );

  RETURN QUERY
  SELECT
    COALESCE(ad.content, '')::text as content,
    ad.created_at,
    COALESCE(ad.decade, '')::text as decade,
    COALESCE(ad.description, '')::text as description,
    COALESCE(ad.description_key, '')::text as description_key,
    ad.document_type::text,
    COALESCE(ad.editorial_note, '')::text as editorial_note,
    COALESCE(ad.editorial_note_key, '')::text as editorial_note_key,
    COALESCE(ad.facility, '')::text as facility,
    ad.id,
    COALESCE(ad.is_current_version, false) as is_current_version,
    COALESCE(ad.is_download_public, false) as is_download_public,
    COALESCE(ad.is_featured, false) as is_featured,
    COALESCE(ad.is_public, false) as is_public,
    COALESCE(ad.keywords, ARRAY[]::text[]) as keywords,
    COALESCE(ad.original_language, '')::text as original_language,
    COALESCE(ad.page_count, 0)::integer as page_count,
    COALESCE(ad.parent_document_id::text, '')::text as parent_document_id,
    COALESCE(ad.people, ARRAY[]::text[]) as people,
    COALESCE(ad.place, '')::text as place,
    COALESCE(ad.preparation, '')::text as preparation,
    ad.provenance_badge::text,
    COALESCE(
      (SELECT array_agg(x::text) FROM unnest(ad.related_documents) x),
      ARRAY[]::text[]
    ) as related_documents,
    COALESCE(ad.scan_url, '')::text as scan_url,
    ad.slug::text,
    COALESCE(ad.source_publication, '')::text as source_publication,
    COALESCE(ad.standards_context, '')::text as standards_context,
    COALESCE(ad.standards_context_key, '')::text as standards_context_key,
    COALESCE(ad.storage_path, '')::text as storage_path,
    COALESCE(ad.summary_key, '')::text as summary_key,
    ad.title::text,
    COALESCE(ad.title_key, '')::text as title_key,
    COALESCE(ad.transcript_url, '')::text as transcript_url,
    ad.updated_at,
    COALESCE(ad.version, '')::text as version,
    COALESCE(ad.version_date::text, '')::text as version_date,
    COALESCE(ad.version_notes, '')::text as version_notes,
    COALESCE(ad.what_you_are_looking_at, '')::text as what_you_are_looking_at,
    COALESCE(ad.what_you_are_looking_at_key, '')::text as what_you_are_looking_at_key,
    COALESCE(ad.year, 0)::integer as year
  FROM public.archive_documents ad
  ORDER BY ad.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_archive_documents_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archive_documents_admin() TO authenticated;

