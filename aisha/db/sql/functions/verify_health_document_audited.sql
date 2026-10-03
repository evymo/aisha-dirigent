-- Function: public.verify_health_document_audited
-- Arguments: p_document_id uuid, p_review_notes text
-- Description: Marks a health document as verified by admin/staff or authorized partner. Audited.

CREATE OR REPLACE FUNCTION public.verify_health_document_audited(
  p_document_id uuid,
  p_review_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_partner_id uuid;
  v_is_admin boolean;
  v_doc record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, user_id, study_registration_id
  INTO v_doc
  FROM public.member_health_documents
  WHERE id = p_document_id;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);
  SELECT pp.id INTO v_partner_id FROM public.partner_profiles pp WHERE pp.user_id = v_user_id;

  IF NOT (
    v_is_admin
    OR (
      v_partner_id IS NOT NULL
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
      )
    )
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.member_health_documents
  SET
    verified_at = now(),
    verified_by = v_user_id,
    review_notes = COALESCE(p_review_notes, review_notes),
    updated_at = now()
  WHERE id = p_document_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update',
      p_area := 'documents',
      p_details := jsonb_build_object('reviewer_role', CASE WHEN v_is_admin THEN 'admin_or_staff' ELSE 'partner' END),
      p_entity_id := p_document_id::text,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Health document verified',
      p_tags := ARRAY['phi','documents','review'],
      p_user_id := v_user_id
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.verify_health_document_audited(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_health_document_audited(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_health_document_audited(uuid, text) TO authenticated;
