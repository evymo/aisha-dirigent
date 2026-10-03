-- Function: public.get_my_document_sharing_permissions_audited
-- Arguments: p_document_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:55+01:00

CREATE OR REPLACE FUNCTION public.get_my_document_sharing_permissions_audited(p_document_id uuid)
 RETURNS TABLE(id uuid, document_id uuid, user_id uuid, shared_with_partner_id uuid, shared_with_study_id uuid, can_view boolean, can_use_for_statistics boolean, can_use_for_research boolean, granted_at timestamptz, revoked_at timestamptz, created_at timestamptz, updated_at timestamptz, partner_profile jsonb, study jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'documents'::journal_area,
      p_details := jsonb_build_object('document_id', p_document_id),
      p_entity_id := p_document_id::text,
      p_entity_type := 'document_sharing_permission',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User viewed document sharing permissions',
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
    dsp.updated_at,
    CASE
      WHEN pp.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', pp.id,
        'display_name', pp.display_name,
        'business_name', pp.business_name
      )
    END AS partner_profile,
    CASE
      WHEN s.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'code', s.code
      )
    END AS study
  FROM document_sharing_permissions dsp
  JOIN member_health_documents mhd ON mhd.id = dsp.document_id
  LEFT JOIN partner_profiles pp ON pp.id = dsp.shared_with_partner_id
  LEFT JOIN studies s ON s.id = dsp.shared_with_study_id
  WHERE dsp.document_id = p_document_id
    AND mhd.user_id = v_user_id
    AND dsp.revoked_at IS NULL
  ORDER BY dsp.granted_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_document_sharing_permissions_audited(p_document_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_document_sharing_permissions_audited(p_document_id uuid) TO authenticated;

-- Security: Revoke anon access (Pattern D - audited functions)
REVOKE EXECUTE ON FUNCTION public.get_my_document_sharing_permissions_audited(p_document_id uuid) FROM anon;
