-- Function: public.get_health_document_for_analysis_audited
-- Arguments: p_document_id uuid
-- Description: Returns minimal document fields for AI analysis (owner only). Audited.

CREATE OR REPLACE FUNCTION public.get_health_document_for_analysis_audited(
  p_document_id uuid
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  file_name text,
  file_path text,
  file_size integer,
  mime_type text,
  category health_document_category,
  title text,
  description text,
  document_date date,
  extracted_text text,
  processing_status document_processing_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_doc record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id,
    user_id,
    file_name,
    file_path,
    file_size,
    mime_type,
    category,
    title,
    description,
    document_date,
    extracted_text,
    processing_status
  INTO v_doc
  FROM public.member_health_documents
  WHERE id = p_document_id;

  IF v_doc.id IS NULL OR v_doc.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'documents',
      p_details := jsonb_build_object('status', v_doc.processing_status::text),
      p_entity_id := p_document_id::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Health document analysis context requested',
      p_tags := ARRAY['phi','documents','analysis'],
      p_user_id := v_user_id
  );

  RETURN QUERY SELECT
    v_doc.id,
    v_doc.user_id,
    v_doc.file_name,
    v_doc.file_path,
    v_doc.file_size,
    v_doc.mime_type,
    v_doc.category,
    v_doc.title,
    v_doc.description,
    v_doc.document_date,
    v_doc.extracted_text,
    v_doc.processing_status;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_health_document_for_analysis_audited(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_health_document_for_analysis_audited(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_health_document_for_analysis_audited(uuid) TO authenticated;
