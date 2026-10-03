-- Function: public.submit_study_participant_consent
-- Arguments: p_study_id uuid, p_consent_type text, p_signature_data text
-- Description: User submits their own consent for study participation. Self-service function.
-- Security: SECURITY DEFINER - user can only submit their own consent (auth.uid()).
-- @audit: required
-- @phi: false (user manages own consent, not accessing others' data)

CREATE OR REPLACE FUNCTION public.submit_study_participant_consent(p_study_id uuid, p_consent_type text, p_signature_data text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_consent_id UUID;
  v_version TEXT;
BEGIN
  -- Owner check: user_id = auth.uid() (self-service only)
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_study_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Study required');
  END IF;

  IF p_consent_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Consent type required');
  END IF;

  IF p_consent_type = 'informed_consent' THEN
    SELECT informed_consent_version INTO v_version
    FROM studies
    WHERE id = p_study_id;
  END IF;

  v_version := COALESCE(v_version, '1.0');

  INSERT INTO consents (
    user_id,
    study_id,
    consent_type,
    granted,
    granted_at,
    signature_data,
    version
  ) VALUES (
    v_user_id,
    p_study_id,
    p_consent_type::consent_type,
    true,
    now(),
    p_signature_data,
    v_version
  )
  ON CONFLICT (user_id, consent_type, study_id)
  DO UPDATE SET
    granted = true,
    granted_at = now(),
    revoked_at = NULL,
    signature_data = COALESCE(EXCLUDED.signature_data, consents.signature_data),
    version = EXCLUDED.version
  RETURNING id INTO v_consent_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'consents'::journal_area,
      p_details := jsonb_build_object(
      'consent_type', p_consent_type,
      'study_id', p_study_id
    ),
      p_entity_id := v_consent_id::text,
      p_entity_type := 'consent',
      p_severity := 'info'::journal_severity,
      p_summary := 'User granted consent',
      p_tags := ARRAY['consent', 'self'],
      p_user_id := v_user_id
  );

  RETURN jsonb_build_object('success', true, 'id', v_consent_id, 'version', v_version);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_study_participant_consent(p_study_id uuid, p_consent_type text, p_signature_data text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_study_participant_consent(p_study_id uuid, p_consent_type text, p_signature_data text) TO authenticated;
