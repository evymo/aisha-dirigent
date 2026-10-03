-- Function: public.update_archive_document_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:54.360Z

CREATE OR REPLACE FUNCTION public.update_archive_document_admin(p_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Get current slug for key generation if slug changes
  SELECT slug INTO v_slug FROM archive_documents WHERE id = p_id;

  IF p_data ? 'slug' THEN
    v_slug := p_data->>'slug';
  END IF;

  UPDATE archive_documents SET
    title = COALESCE(p_data->>'title', title),
    title_key = CASE WHEN p_data ? 'slug' THEN 'archive.' || v_slug || '.title' ELSE title_key END,
    slug = COALESCE(p_data->>'slug', slug),
    document_type = COALESCE(p_data->>'document_type', document_type),
    provenance_badge = COALESCE(p_data->>'provenance_badge', provenance_badge),
    description = CASE WHEN p_data ? 'description' THEN p_data->>'description' ELSE description END,
    description_key = CASE WHEN p_data ? 'slug' THEN 'archive.' || v_slug || '.description' ELSE description_key END,
    content = CASE WHEN p_data ? 'content' THEN p_data->>'content' ELSE content END,
    year = CASE WHEN p_data ? 'year' THEN (p_data->>'year')::int ELSE year END,
    decade = CASE WHEN p_data ? 'decade' THEN p_data->>'decade' ELSE decade END,
    facility = CASE WHEN p_data ? 'facility' THEN p_data->>'facility' ELSE facility END,
    place = CASE WHEN p_data ? 'place' THEN p_data->>'place' ELSE place END,
    people = CASE
      WHEN p_data ? 'people' AND p_data->'people' IS NOT NULL AND jsonb_typeof(p_data->'people') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'people'))
      WHEN p_data ? 'people' AND (p_data->'people' IS NULL OR jsonb_typeof(p_data->'people') = 'null')
      THEN NULL
      ELSE people
    END,
    keywords = CASE
      WHEN p_data ? 'keywords' AND p_data->'keywords' IS NOT NULL AND jsonb_typeof(p_data->'keywords') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'keywords'))
      WHEN p_data ? 'keywords' AND (p_data->'keywords' IS NULL OR jsonb_typeof(p_data->'keywords') = 'null')
      THEN NULL
      ELSE keywords
    END,
    preparation = CASE WHEN p_data ? 'preparation' THEN p_data->>'preparation' ELSE preparation END,
    is_featured = CASE WHEN p_data ? 'is_featured' THEN COALESCE((p_data->>'is_featured')::boolean, false) ELSE is_featured END,
    is_download_public = CASE WHEN p_data ? 'is_download_public' THEN COALESCE((p_data->>'is_download_public')::boolean, false) ELSE is_download_public END,
    storage_path = CASE WHEN p_data ? 'storage_path' THEN p_data->>'storage_path' ELSE storage_path END,
    original_language = CASE WHEN p_data ? 'original_language' THEN p_data->>'original_language' ELSE original_language END,
    source_publication = CASE WHEN p_data ? 'source_publication' THEN p_data->>'source_publication' ELSE source_publication END,
    page_count = CASE WHEN p_data ? 'page_count' THEN (p_data->>'page_count')::int ELSE page_count END,
    scan_url = CASE WHEN p_data ? 'scan_url' THEN p_data->>'scan_url' ELSE scan_url END,
    transcript_url = CASE WHEN p_data ? 'transcript_url' THEN p_data->>'transcript_url' ELSE transcript_url END,
    summary_key = CASE WHEN p_data ? 'slug' THEN 'archive.' || v_slug || '.summary' ELSE summary_key END,
    what_you_are_looking_at = CASE WHEN p_data ? 'what_you_are_looking_at' THEN p_data->>'what_you_are_looking_at' ELSE what_you_are_looking_at END,
    what_you_are_looking_at_key = CASE WHEN p_data ? 'slug' THEN 'archive.' || v_slug || '.what_you_are_looking_at' ELSE what_you_are_looking_at_key END,
    standards_context = CASE WHEN p_data ? 'standards_context' THEN p_data->>'standards_context' ELSE standards_context END,
    standards_context_key = CASE WHEN p_data ? 'slug' THEN 'archive.' || v_slug || '.standards_context' ELSE standards_context_key END,
    editorial_note = CASE WHEN p_data ? 'editorial_note' THEN p_data->>'editorial_note' ELSE editorial_note END,
    editorial_note_key = CASE WHEN p_data ? 'slug' THEN 'archive.' || v_slug || '.editorial_note' ELSE editorial_note_key END,
    updated_at = now()
  WHERE id = p_id;

  INSERT INTO audit_journal (
    action, user_id, action_type, area, entity_type, entity_id, summary, severity
  ) VALUES (
    'UPDATE_ARCHIVE_DOCUMENT_ADMIN', auth.uid(), 'update', 'content', 'archive_document', p_id::text,
    'Updated archive document',
    'info'
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_archive_document_admin(p_id uuid, p_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_archive_document_admin(p_id uuid, p_data jsonb) TO authenticated;

