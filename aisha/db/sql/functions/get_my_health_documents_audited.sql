-- Function: public.get_my_health_documents_audited
-- Arguments: p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:57+01:00

CREATE OR REPLACE FUNCTION public.get_my_health_documents_audited(p_limit integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, user_id uuid, study_registration_id uuid, file_name text, file_path text, file_size integer, mime_type text, category health_document_category, title text, description text, document_date date, processing_status document_processing_status, processed_at timestamptz, extracted_data jsonb, extracted_text text, ocr_metadata jsonb, capture_metadata jsonb, ai_summary text, ai_insights jsonb, ai_categories text[], tokens_awarded numeric, tokens_awarded_at timestamptz, contributed_to_statistics boolean, contributed_at timestamptz, verified_at timestamptz, verified_by uuid, review_notes text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'documents'::journal_area,
      p_details := jsonb_build_object('limit', p_limit),
      p_entity_id := auth.uid()::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User viewed health documents',
      p_tags := ARRAY['phi', 'documents'],
      p_user_id := auth.uid()
  );

  IF p_limit IS NULL THEN
    RETURN QUERY
    SELECT
      mhd.id,
      mhd.user_id,
      mhd.study_registration_id,
      mhd.file_name,
      mhd.file_path,
      mhd.file_size,
      mhd.mime_type,
      mhd.category,
      mhd.title,
      mhd.description,
      mhd.document_date,
      mhd.processing_status,
      mhd.processed_at,
      mhd.extracted_data,
      mhd.extracted_text,
      mhd.ocr_metadata,
      mhd.capture_metadata,
      mhd.ai_summary,
      mhd.ai_insights,
      mhd.ai_categories,
      mhd.tokens_awarded,
      mhd.tokens_awarded_at,
      mhd.contributed_to_statistics,
      mhd.contributed_at,
      mhd.verified_at,
      mhd.verified_by,
      mhd.review_notes,
      mhd.created_at,
      mhd.updated_at
    FROM member_health_documents mhd
    WHERE mhd.user_id = auth.uid()
    ORDER BY mhd.created_at DESC;
  ELSE
    RETURN QUERY
    SELECT
      mhd.id,
      mhd.user_id,
      mhd.study_registration_id,
      mhd.file_name,
      mhd.file_path,
      mhd.file_size,
      mhd.mime_type,
      mhd.category,
      mhd.title,
      mhd.description,
      mhd.document_date,
      mhd.processing_status,
      mhd.processed_at,
      mhd.extracted_data,
      mhd.extracted_text,
      mhd.ocr_metadata,
      mhd.capture_metadata,
      mhd.ai_summary,
      mhd.ai_insights,
      mhd.ai_categories,
      mhd.tokens_awarded,
      mhd.tokens_awarded_at,
      mhd.contributed_to_statistics,
      mhd.contributed_at,
      mhd.verified_at,
      mhd.verified_by,
      mhd.review_notes,
      mhd.created_at,
      mhd.updated_at
    FROM member_health_documents mhd
    WHERE mhd.user_id = auth.uid()
    ORDER BY mhd.created_at DESC
    LIMIT p_limit;
  END IF;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_health_documents_audited(p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_health_documents_audited(p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_health_documents_audited(p_limit integer) TO authenticated;
