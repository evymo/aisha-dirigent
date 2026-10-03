-- Function: public.delete_archive_document_admin
-- Arguments: p_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:21+01:00

CREATE OR REPLACE FUNCTION public.delete_archive_document_admin(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
BEGIN
  -- Admin/staff check using standard helper
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Get title for audit log
  SELECT title INTO v_title FROM archive_documents WHERE id = p_id;

  DELETE FROM archive_documents WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'archive_document',
      p_new_values := jsonb_build_object('title', v_title),
      p_old_values := NULL,
      p_severity := 'warning'::public.journal_severity,
      p_summary := 'Deleted archive document: ' || COALESCE(v_title, 'unknown'),
      p_tags := ARRAY['admin', 'archive_document', 'delete'],
      p_user_id := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_archive_document_admin(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_archive_document_admin(p_id uuid) TO authenticated;
