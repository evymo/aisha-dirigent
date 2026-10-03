-- Function: public.grant_document_sharing_permission_audited
-- Arguments: p_document_id uuid, p_partner_id uuid, p_study_id uuid, p_can_view boolean, p_can_use_for_statistics boolean, p_can_use_for_research boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:49+01:00

CREATE OR REPLACE FUNCTION public.grant_document_sharing_permission_audited(p_document_id uuid, p_partner_id uuid DEFAULT NULL::uuid, p_study_id uuid DEFAULT NULL::uuid, p_can_view boolean DEFAULT true, p_can_use_for_statistics boolean DEFAULT false, p_can_use_for_research boolean DEFAULT false)
 RETURNS TABLE(id uuid, document_id uuid, user_id uuid, shared_with_partner_id uuid, shared_with_study_id uuid, can_view boolean, can_use_for_statistics boolean, can_use_for_research boolean, granted_at timestamptz, revoked_at timestamptz, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_permission_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_partner_id IS NULL AND p_study_id IS NULL THEN
    RAISE EXCEPTION 'Missing target for sharing permission';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM member_health_documents mhd
    WHERE mhd.id = p_document_id AND mhd.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  INSERT INTO document_sharing_permissions (
    document_id,
    user_id,
    shared_with_partner_id,
    shared_with_study_id,
    can_view,
    can_use_for_statistics,
    can_use_for_research
  )
  VALUES (
    p_document_id,
    v_user_id,
    p_partner_id,
    p_study_id,
    p_can_view,
    p_can_use_for_statistics,
    p_can_use_for_research
  )
  RETURNING id INTO v_permission_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'documents'::journal_area,
      p_details := jsonb_build_object(
      'document_id', p_document_id,
      'partner_id', p_partner_id,
      'study_id', p_study_id,
      'can_view', p_can_view,
      'can_use_for_statistics', p_can_use_for_statistics,
      'can_use_for_research', p_can_use_for_research
    ),
      p_entity_id := v_permission_id::text,
      p_entity_type := 'document_sharing_permission',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User granted document sharing permission',
      p_tags := ARRAY['phi', 'documents', 'sharing'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    dsp.id,
    dsp.document_id,
    dsp.user_id,
    dsp.shared_with_partner_id,
    dsp.shared_with_study_id,
    dsp.can_view,
    dsp.can_use_for_statistics,
    dsp.can_use_for_research,
    dsp.granted_at,
    dsp.revoked_at,
    dsp.created_at,
    dsp.updated_at
  FROM document_sharing_permissions dsp
  WHERE dsp.id = v_permission_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.grant_document_sharing_permission_audited(p_document_id uuid, p_partner_id uuid, p_study_id uuid, p_can_view boolean, p_can_use_for_statistics boolean, p_can_use_for_research boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_document_sharing_permission_audited(p_document_id uuid, p_partner_id uuid, p_study_id uuid, p_can_view boolean, p_can_use_for_statistics boolean, p_can_use_for_research boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_document_sharing_permission_audited(p_document_id uuid, p_partner_id uuid, p_study_id uuid, p_can_view boolean, p_can_use_for_statistics boolean, p_can_use_for_research boolean) TO authenticated;
