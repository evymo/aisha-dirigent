-- Function: public.submit_health_document_analysis_audited
-- Arguments: p_document_id uuid, p_extracted_data jsonb, p_ai_summary text, p_ai_insights jsonb, p_ai_categories text[], p_tokens_awarded integer
-- Description: Stores AI analysis results for a health document and optionally awards tokens (owner only). Audited.

CREATE OR REPLACE FUNCTION public.submit_health_document_analysis_audited(
  p_document_id uuid,
  p_extracted_data jsonb DEFAULT NULL::jsonb,
  p_ai_summary text DEFAULT NULL::text,
  p_ai_insights jsonb DEFAULT NULL::jsonb,
  p_ai_categories text[] DEFAULT NULL::text[],
  p_tokens_awarded integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_doc record;
  v_award_now boolean := false;
  v_tokens integer := 0;
  v_tokens_awarded_at timestamptz := NULL;
  v_award_error text := NULL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, user_id, tokens_awarded, tokens_awarded_at
  INTO v_doc
  FROM public.member_health_documents
  WHERE id = p_document_id;

  IF v_doc.id IS NULL OR v_doc.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_tokens := GREATEST(0, COALESCE(p_tokens_awarded, 0));
  v_award_now := v_tokens > 0 AND v_doc.tokens_awarded_at IS NULL;

  IF v_award_now THEN
    BEGIN
      PERFORM public.award_tokens(
        v_user_id,
        'data',
        v_tokens,
        'health_document',
        p_document_id,
        'Document analysis reward'
      );
      v_tokens_awarded_at := now();
    EXCEPTION WHEN others THEN
      v_award_error := SQLERRM;
      v_award_now := false;
      v_tokens := 0;
      v_tokens_awarded_at := NULL;
    END;
  END IF;

  UPDATE public.member_health_documents
  SET
    processing_status = 'completed',
    processed_at = now(),
    extracted_data = COALESCE(p_extracted_data, extracted_data),
    ai_summary = COALESCE(p_ai_summary, ai_summary),
    ai_insights = COALESCE(p_ai_insights, ai_insights),
    ai_categories = COALESCE(p_ai_categories, ai_categories),
    tokens_awarded = CASE WHEN v_award_now THEN v_tokens ELSE tokens_awarded END,
    tokens_awarded_at = CASE WHEN v_award_now THEN v_tokens_awarded_at ELSE tokens_awarded_at END,
    updated_at = now()
  WHERE id = p_document_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update',
      p_area := 'documents',
      p_details := jsonb_build_object(
      'tokens_awarded', v_tokens,
      'award_attempted', v_award_now,
      'award_error', NULLIF(v_award_error, '')
    ),
      p_entity_id := p_document_id::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Health document analysis stored',
      p_tags := ARRAY['phi','documents','analysis'],
      p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'tokens_awarded', v_tokens,
    'tokens_awarded_at', v_tokens_awarded_at
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_health_document_analysis_audited(uuid, jsonb, text, jsonb, text[], integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_health_document_analysis_audited(uuid, jsonb, text, jsonb, text[], integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_health_document_analysis_audited(uuid, jsonb, text, jsonb, text[], integer) TO authenticated;
