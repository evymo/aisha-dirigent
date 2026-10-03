-- Function: public.get_user_consents_audited
-- Arguments: p_user_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_user_consents_audited(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_partner_id uuid;
  v_has_access boolean := false;
  v_result jsonb;
BEGIN
  -- Get authenticated user
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify consultant has access to this user
  SELECT pp.id INTO v_partner_id
  FROM partner_profiles pp
  WHERE pp.user_id = v_actor_id;

  IF v_partner_id IS NOT NULL THEN
    -- Check consultant relationship AND data_sharing_consent
    SELECT EXISTS (
      SELECT 1 FROM study_registrations se
      JOIN study_consultants sc ON sc.id = se.consultant_id
      WHERE se.user_id = p_user_id
        AND sc.partner_id = v_partner_id
        AND sc.status = 'approved'
    ) AND public.has_data_sharing_consent(p_user_id, v_actor_id)
    INTO v_has_access;
  END IF;

  -- Admin bypass
  IF NOT v_has_access AND public.is_admin_or_staff(v_actor_id) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'Access denied to user data';
  END IF;

  -- Log the access
  INSERT INTO audit_journal (
    entity_type,
    entity_id,
    action,
    user_id,
    new_data
  ) VALUES (
    'consents',
    p_user_id,
    'SELECT',
    v_actor_id,
    jsonb_build_object('context', 'consultant_user_view')
  );

  -- Get consents
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'consent_type', c.consent_type,
        'granted', c.granted,
        'granted_at', c.granted_at
      )
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM consents c
  WHERE c.user_id = p_user_id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_consents_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_consents_audited(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_consents_audited(uuid) TO service_role;
