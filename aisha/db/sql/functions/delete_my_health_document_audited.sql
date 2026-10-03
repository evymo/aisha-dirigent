-- Function: public.delete_my_health_document_audited
-- Arguments: p_document_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:22+01:00

CREATE OR REPLACE FUNCTION public.delete_my_health_document_audited(p_document_id uuid)
 RETURNS boolean
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

  IF NOT EXISTS (
    SELECT 1
    FROM member_health_documents mhd
    WHERE mhd.id = p_document_id
      AND mhd.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  DELETE FROM member_health_documents
  WHERE id = p_document_id AND user_id = v_user_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::journal_action_type,
      p_area := 'documents'::journal_area,
      p_details := jsonb_build_object('document_id', p_document_id),
      p_entity_id := p_document_id::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User deleted health document',
      p_tags := ARRAY['phi', 'documents'],
      p_user_id := v_user_id
  );

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_my_health_document_audited(p_document_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_my_health_document_audited(p_document_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_my_health_document_audited(p_document_id uuid) TO authenticated;
