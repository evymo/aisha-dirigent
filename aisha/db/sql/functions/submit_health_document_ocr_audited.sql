-- Function: public.submit_health_document_ocr_audited
-- Arguments: p_document_id uuid, p_extracted_text text, p_ocr_metadata jsonb, p_capture_metadata jsonb
-- Description: Stores on-device OCR output and capture metadata for a health document (owner only). Audited.

CREATE OR REPLACE FUNCTION public.submit_health_document_ocr_audited(
  p_document_id uuid,
  p_extracted_text text,
  p_ocr_metadata jsonb DEFAULT NULL::jsonb,
  p_capture_metadata jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
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

  SELECT id, user_id
  INTO v_doc
  FROM public.member_health_documents
  WHERE id = p_document_id;

  IF v_doc.id IS NULL OR v_doc.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.member_health_documents
  SET
    extracted_text = COALESCE(p_extracted_text, extracted_text),
    ocr_metadata = COALESCE(p_ocr_metadata, ocr_metadata),
    capture_metadata = COALESCE(p_capture_metadata, capture_metadata),
    updated_at = now()
  WHERE id = p_document_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update',
      p_area := 'documents',
      p_details := jsonb_build_object(
      'ocr_text_length', COALESCE(length(p_extracted_text), 0),
      'has_ocr_metadata', p_ocr_metadata IS NOT NULL,
      'has_capture_metadata', p_capture_metadata IS NOT NULL
    ),
      p_entity_id := p_document_id::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Health document OCR submitted',
      p_tags := ARRAY['phi','documents','ocr'],
      p_user_id := v_user_id
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_health_document_ocr_audited(uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_health_document_ocr_audited(uuid, text, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_health_document_ocr_audited(uuid, text, jsonb, jsonb) TO authenticated;
