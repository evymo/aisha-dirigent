-- Function: public.get_health_document_download_info_audited
-- Arguments: p_document_id uuid
-- Description: Returns file path for a health document if the caller is authorized (owner/admin/partner). Audited.

CREATE OR REPLACE FUNCTION public.get_health_document_download_info_audited(
  p_document_id uuid
)
RETURNS TABLE(
  id uuid,
  file_path text,
  user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_partner_id uuid;
  v_is_admin boolean;
  v_doc record;
  v_access text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, user_id, file_path
  INTO v_doc
  FROM public.member_health_documents
  WHERE id = p_document_id;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);
  SELECT pp.id INTO v_partner_id FROM public.partner_profiles pp WHERE pp.user_id = v_user_id;

  IF v_doc.user_id = v_user_id THEN
    v_access := 'owner';
  ELSIF v_is_admin THEN
    v_access := 'admin_or_staff';
  ELSIF v_partner_id IS NOT NULL
    AND public.has_data_sharing_consent(v_doc.user_id, v_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.document_sharing_permissions dsp
      WHERE dsp.document_id = v_doc.id
        AND dsp.revoked_at IS NULL
        AND dsp.can_view = true
        AND (
          dsp.shared_with_partner_id = v_partner_id
          OR (dsp.shared_with_study_id IS NOT NULL AND public.is_study_consultant(dsp.shared_with_study_id))
        )
    ) THEN
    v_access := 'partner';
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'documents',
      p_details := jsonb_build_object('access', v_access),
      p_entity_id := p_document_id::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Health document download authorized',
      p_tags := ARRAY['phi','documents','download'],
      p_user_id := v_user_id
  );

  RETURN QUERY SELECT v_doc.id, v_doc.file_path, v_doc.user_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_health_document_download_info_audited(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_health_document_download_info_audited(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_health_document_download_info_audited(uuid) TO authenticated;
