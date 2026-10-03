-- Function: public.revoke_document_sharing_permission_audited
-- Arguments: p_permission_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:02+01:00

CREATE OR REPLACE FUNCTION public.revoke_document_sharing_permission_audited(p_permission_id uuid)
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
    FROM document_sharing_permissions dsp
    WHERE dsp.id = p_permission_id
      AND dsp.user_id = v_user_id
      AND dsp.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Permission not found';
  END IF;

  UPDATE document_sharing_permissions
  SET revoked_at = now(), updated_at = now()
  WHERE id = p_permission_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'cancel'::journal_action_type,
      p_area := 'documents'::journal_area,
      p_details := jsonb_build_object('permission_id', p_permission_id),
      p_entity_id := p_permission_id::text,
      p_entity_type := 'document_sharing_permission',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User revoked document sharing permission',
      p_tags := ARRAY['phi', 'documents', 'sharing'],
      p_user_id := v_user_id
  );

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.revoke_document_sharing_permission_audited(p_permission_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_document_sharing_permission_audited(p_permission_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_document_sharing_permission_audited(p_permission_id uuid) TO authenticated;
