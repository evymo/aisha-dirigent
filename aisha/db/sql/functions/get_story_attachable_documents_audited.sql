-- Function: public.get_story_attachable_documents_audited
-- Arguments: p_story_id uuid, p_limit integer
-- Description: Returns member documents that can be attached by the owning partner in a story entry. Audited.

CREATE OR REPLACE FUNCTION public.get_story_attachable_documents_audited(
  p_story_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  file_name text,
  file_path text,
  mime_type text,
  category health_document_category,
  title text,
  description text,
  document_date date,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_partner_id uuid;
  v_story_partner_id uuid;
  v_owner_mode TEXT;
  v_audit_area public.journal_area;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_current_partner_id();

  SELECT ps.partner_id, ps.user_id
  INTO v_story_partner_id, v_user_id
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;

  IF v_story_partner_id IS NULL THEN
    RAISE EXCEPTION 'Story not found';
  END IF;

  IF v_partner_id IS NOT NULL AND v_story_partner_id = v_partner_id THEN
    v_owner_mode := 'partner';
  ELSIF v_user_id = v_user_id THEN
    v_owner_mode := 'member';
  ELSE
    RAISE EXCEPTION 'Unauthorized: Story access denied';
  END IF;

  IF v_owner_mode = 'partner' AND NOT public.has_data_sharing_consent(v_user_id, v_user_id) THEN
    RAISE EXCEPTION 'Unauthorized: Missing sharing consent';
  END IF;

  v_audit_area := CASE
    WHEN v_owner_mode = 'partner' THEN 'documents'::public.journal_area
    ELSE 'member'::public.journal_area
  END;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := v_audit_area,
      p_details := jsonb_build_object(
        'owner_mode', v_owner_mode,
        'story_id', p_story_id,
        'limit', GREATEST(0, COALESCE(p_limit, 0))
      ),
      p_entity_id := p_story_id::text,
      p_entity_type := 'partner_story',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := CASE
        WHEN v_owner_mode = 'partner' THEN 'Partner viewed attachable story documents'
        ELSE 'Member viewed attachable story documents'
      END,
      p_tags := ARRAY['phi','documents','story','attach'],
      p_user_id := v_user_id
  );

  IF v_owner_mode = 'partner' THEN
    RETURN QUERY
    SELECT DISTINCT
      mhd.id,
      mhd.user_id,
      mhd.file_name,
      mhd.file_path,
      mhd.mime_type,
      mhd.category,
      mhd.title,
      mhd.description,
      mhd.document_date,
      mhd.created_at
    FROM public.member_health_documents mhd
    JOIN public.document_sharing_permissions dsp
      ON dsp.document_id = mhd.id
     AND dsp.revoked_at IS NULL
     AND dsp.can_view = true
    WHERE mhd.user_id = v_user_id
      AND (
        dsp.shared_with_partner_id = v_partner_id
        OR (
          dsp.shared_with_study_id IS NOT NULL
          AND public.is_study_consultant(dsp.shared_with_study_id)
        )
      )
    ORDER BY mhd.created_at DESC
    LIMIT GREATEST(0, COALESCE(p_limit, 0));
  ELSE
    RETURN QUERY
    SELECT
      mhd.id,
      mhd.user_id,
      mhd.file_name,
      mhd.file_path,
      mhd.mime_type,
      mhd.category,
      mhd.title,
      mhd.description,
      mhd.document_date,
      mhd.created_at
    FROM public.member_health_documents mhd
    WHERE mhd.user_id = v_user_id
    ORDER BY mhd.created_at DESC
    LIMIT GREATEST(0, COALESCE(p_limit, 0));
  END IF;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_story_attachable_documents_audited(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_story_attachable_documents_audited(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_story_attachable_documents_audited(uuid, integer) TO authenticated;
