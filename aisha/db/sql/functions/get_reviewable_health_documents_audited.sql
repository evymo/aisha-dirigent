-- Function: public.get_reviewable_health_documents_audited
-- Arguments: p_limit integer
-- Description: Returns health documents pending review for admin/staff or authorized partners. Audited.

CREATE OR REPLACE FUNCTION public.get_reviewable_health_documents_audited(
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  study_registration_id uuid,
  file_name text,
  file_path text,
  file_size integer,
  mime_type text,
  category health_document_category,
  title text,
  description text,
  document_date date,
  processing_status document_processing_status,
  processed_at timestamptz,
  extracted_text text,
  ocr_metadata jsonb,
  capture_metadata jsonb,
  extracted_data jsonb,
  ai_summary text,
  ai_insights jsonb,
  ai_categories text[],
  verified_at timestamptz,
  verified_by uuid,
  review_notes text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_partner_id uuid;
  v_is_admin boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);
  SELECT pp.id INTO v_partner_id FROM public.partner_profiles pp WHERE pp.user_id = v_user_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'documents',
      p_details := jsonb_build_object('limit', GREATEST(0, COALESCE(p_limit, 0))),
      p_entity_id := NULL,
      p_entity_type := 'member_health_document',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'Reviewer viewed pending health documents',
      p_tags := ARRAY['phi','documents','review'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    mhd.id,
    mhd.user_id,
    mhd.study_registration_id,
    mhd.file_name,
    mhd.file_path,
    mhd.file_size,
    mhd.mime_type,
    mhd.category,
    mhd.title,
    mhd.description,
    mhd.document_date,
    mhd.processing_status,
    mhd.processed_at,
    mhd.extracted_text,
    mhd.ocr_metadata,
    mhd.capture_metadata,
    mhd.extracted_data,
    mhd.ai_summary,
    mhd.ai_insights,
    mhd.ai_categories,
    mhd.verified_at,
    mhd.verified_by,
    mhd.review_notes,
    mhd.created_at,
    mhd.updated_at
  FROM public.member_health_documents mhd
  WHERE mhd.processing_status = 'completed'
    AND mhd.verified_at IS NULL
    AND (
      v_is_admin
      OR (
        v_partner_id IS NOT NULL
        AND public.has_data_sharing_consent(mhd.user_id, v_user_id)
        AND EXISTS (
          SELECT 1
          FROM public.document_sharing_permissions dsp
          WHERE dsp.document_id = mhd.id
            AND dsp.revoked_at IS NULL
            AND dsp.can_view = true
            AND (
              dsp.shared_with_partner_id = v_partner_id
              OR (dsp.shared_with_study_id IS NOT NULL AND public.is_study_consultant(dsp.shared_with_study_id))
            )
        )
      )
    )
  ORDER BY mhd.created_at DESC
  LIMIT GREATEST(0, COALESCE(p_limit, 0));
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_reviewable_health_documents_audited(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_reviewable_health_documents_audited(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_reviewable_health_documents_audited(integer) TO authenticated;
