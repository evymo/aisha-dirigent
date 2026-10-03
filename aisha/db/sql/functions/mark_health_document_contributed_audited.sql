-- Function: public.mark_health_document_contributed_audited
-- Arguments: p_document_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:57+01:00

CREATE OR REPLACE FUNCTION public.mark_health_document_contributed_audited(p_document_id uuid)
 RETURNS TABLE(id uuid, contributed_to_statistics boolean, contributed_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  UPDATE member_health_documents
  SET
    contributed_to_statistics = true,
    contributed_at = now(),
    updated_at = now()
  WHERE id = p_document_id
    AND user_id = v_user_id
  RETURNING
    member_health_documents.id,
    member_health_documents.contributed_to_statistics,
    member_health_documents.contributed_at,
    member_health_documents.updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'documents'::journal_area,
      p_details := jsonb_build_object('document_id', p_document_id),
      p_entity_id := p_document_id::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User contributed health document to statistics',
      p_tags := ARRAY['phi', 'documents', 'statistics'],
      p_user_id := v_user_id
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.mark_health_document_contributed_audited(p_document_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_health_document_contributed_audited(p_document_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_health_document_contributed_audited(p_document_id uuid) TO authenticated;
