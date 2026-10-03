-- Function: public.create_archive_document_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:51.751Z

CREATE OR REPLACE FUNCTION public.create_archive_document_admin(p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  v_slug := COALESCE(p_data->>'slug', 'doc-' || gen_random_uuid()::text);

  INSERT INTO archive_documents (
    title,
    title_key,
    slug,
    document_type,
    provenance_badge,
    description,
    description_key,
    content,
    year,
    decade,
    facility,
    place,
    people,
    keywords,
    preparation,
    is_featured,
    original_language,
    source_publication,
    page_count,
    scan_url,
    transcript_url,
    summary_key,
    what_you_are_looking_at,
    what_you_are_looking_at_key,
    standards_context,
    standards_context_key,
    editorial_note,
    editorial_note_key
  ) VALUES (
    COALESCE(p_data->>'title', 'Untitled'),
    'archive.' || v_slug || '.title',
    v_slug,
    COALESCE(p_data->>'document_type', 'document'),
    COALESCE(p_data->>'provenance_badge', 'original_scan'),
    p_data->>'description',
    'archive.' || v_slug || '.description',
    p_data->>'content',
    (p_data->>'year')::int,
    p_data->>'decade',
    p_data->>'facility',
    p_data->>'place',
    CASE WHEN p_data->'people' IS NOT NULL AND jsonb_typeof(p_data->'people') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'people'))
         ELSE NULL END,
    CASE WHEN p_data->'keywords' IS NOT NULL AND jsonb_typeof(p_data->'keywords') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'keywords'))
         ELSE NULL END,
    p_data->>'preparation',
    COALESCE((p_data->>'is_featured')::boolean, false),
    p_data->>'original_language',
    p_data->>'source_publication',
    (p_data->>'page_count')::int,
    p_data->>'scan_url',
    p_data->>'transcript_url',
    'archive.' || v_slug || '.summary',
    p_data->>'what_you_are_looking_at',
    'archive.' || v_slug || '.what_you_are_looking_at',
    p_data->>'standards_context',
    'archive.' || v_slug || '.standards_context',
    p_data->>'editorial_note',
    'archive.' || v_slug || '.editorial_note'
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_id::text,
      p_entity_type := 'archive_document',
      p_new_values := p_data,
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Created archive document: ' || COALESCE(p_data->>'title', v_slug, 'unknown'),
      p_tags := ARRAY['admin', 'archive_document', 'create'],
      p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_archive_document_admin(p_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_archive_document_admin(p_data jsonb) TO authenticated;

