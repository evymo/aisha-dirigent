-- Function: public.set_health_document_processing_status_audited
-- Arguments: p_document_id uuid, p_status document_processing_status, p_reason text
-- Description: Updates processing status for a health document (owner only). Audited.

CREATE OR REPLACE FUNCTION public.set_health_document_processing_status_audited(
  p_document_id uuid,
  p_status document_processing_status,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_doc record;
  v_processed_at timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, user_id, processing_status
  INTO v_doc
  FROM public.member_health_documents
  WHERE id = p_document_id;

  IF v_doc.id IS NULL OR v_doc.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_status IN ('completed', 'failed') THEN
    v_processed_at := now();
  ELSE
    v_processed_at := NULL;
  END IF;

  UPDATE public.member_health_documents
  SET
    processing_status = p_status,
    processed_at = v_processed_at,
    updated_at = now()
  WHERE id = p_document_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update',
      p_area := 'documents',
      p_details := jsonb_build_object(
      'previous_status', v_doc.processing_status::text,
      'status', p_status::text,
      'reason', NULLIF(p_reason, '')
    ),
      p_entity_id := p_document_id::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Health document processing status updated',
      p_tags := ARRAY['phi','documents','analysis'],
      p_user_id := v_user_id
  );

  RETURN jsonb_build_object('success', true, 'status', p_status::text);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.set_health_document_processing_status_audited(uuid, document_processing_status, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_health_document_processing_status_audited(uuid, document_processing_status, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_health_document_processing_status_audited(uuid, document_processing_status, text) TO authenticated;
