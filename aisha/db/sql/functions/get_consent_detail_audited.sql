-- Source of truth: get_consent_detail_audited
-- See migration: 20260220130000_add_consent_detail_audited.sql

CREATE OR REPLACE FUNCTION public.get_consent_detail_audited(
  p_consent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor_id uuid;
  v_consent_user_id uuid;
  v_partner_id uuid;
  v_has_access boolean := false;
  v_result jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get the owner of the consent
  SELECT c.user_id INTO v_consent_user_id
  FROM consents c
  WHERE c.id = p_consent_id;

  IF v_consent_user_id IS NULL THEN
    RAISE EXCEPTION 'Consent not found';
  END IF;

  -- Self-access
  IF v_actor_id = v_consent_user_id THEN
    v_has_access := true;
  END IF;

  -- Partner/consultant access with data sharing consent check
  IF NOT v_has_access THEN
    SELECT pp.id INTO v_partner_id
    FROM partner_profiles pp
    WHERE pp.user_id = v_actor_id;

    IF v_partner_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM study_registrations se
        JOIN study_consultants sc ON sc.id = se.consultant_id
        WHERE se.user_id = v_consent_user_id
          AND sc.partner_id = v_partner_id
          AND sc.status = 'approved'
      ) AND public.has_data_sharing_consent(v_consent_user_id, v_actor_id)
      INTO v_has_access;
    END IF;
  END IF;

  -- Admin/staff bypass
  IF NOT v_has_access AND public.is_admin_or_staff(v_actor_id) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'Access denied to consent data';
  END IF;

  -- Audit log (no sensitive data in metadata)
  PERFORM public.write_audit_journal(
    p_action_type := 'view',
    p_area := 'operational_data',
    p_details := jsonb_build_object(
      'consent_id', p_consent_id,
      'access_type', CASE
        WHEN v_actor_id = v_consent_user_id THEN 'self'
        WHEN public.is_admin_or_staff(v_actor_id) THEN 'admin'
        ELSE 'consultant'
      END
    ),
    p_entity_id := p_consent_id::text,
    p_entity_type := 'consent',
    p_severity := 'notice',
    p_summary := 'Viewed consent detail',
    p_tags := ARRAY['phi', 'consent', 'detail_view'],
    p_user_id := v_actor_id
  );

  -- Build consent detail with study JOIN
  SELECT jsonb_build_object(
    'id', c.id,
    'user_id', c.user_id,
    'consent_type', c.consent_type,
    'version', c.version,
    'granted', c.granted,
    'granted_at', c.granted_at,
    'revoked_at', c.revoked_at,
    'document_url', c.document_url,
    'created_at', c.created_at,
    'study_id', c.study_id,
    'study_name', s.name,
    'study_name_key', s.name_key,
    'study_code', s.code
  ) INTO v_result
  FROM consents c
  LEFT JOIN studies s ON s.id = c.study_id
  WHERE c.id = p_consent_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_consent_detail_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consent_detail_audited(uuid) TO authenticated;
