-- Function: public.grant_consent
-- Arguments: p_consent_type consent_type, p_study_id uuid, p_version text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:49+01:00

CREATE OR REPLACE FUNCTION public.grant_consent(p_consent_type consent_type, p_study_id uuid DEFAULT NULL::uuid, p_version text DEFAULT '1.0'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_consent_id UUID;
  v_ip_address TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Handle both cases: with study_id and without
  IF p_study_id IS NOT NULL THEN
    -- Upsert consent with study_id
    INSERT INTO consents (user_id, consent_type, study_id, version, granted, granted_at, ip_address)
    VALUES (v_user_id, p_consent_type, p_study_id, p_version, true, NOW(), v_ip_address)
    ON CONFLICT (user_id, consent_type, study_id) WHERE study_id IS NOT NULL
    DO UPDATE SET granted = true, granted_at = NOW(), revoked_at = NULL, version = p_version
    RETURNING id INTO v_consent_id;
  ELSE
    -- Upsert consent without study_id (general consent)
    INSERT INTO consents (user_id, consent_type, study_id, version, granted, granted_at, ip_address)
    VALUES (v_user_id, p_consent_type, NULL, p_version, true, NOW(), v_ip_address)
    ON CONFLICT (user_id, consent_type) WHERE study_id IS NULL
    DO UPDATE SET granted = true, granted_at = NOW(), revoked_at = NULL, version = p_version
    RETURNING id INTO v_consent_id;
  END IF;

  -- Audit log with required action column
  INSERT INTO audit_journal (
    action, user_id, action_type, area, entity_type, entity_id, summary, severity, details, requires_blockchain_record
  ) VALUES (
    'GRANT_CONSENT', v_user_id, 'update', 'consents', 'consents', v_consent_id::TEXT, 'User granted consent', 'warning',
    jsonb_build_object('consent_type', p_consent_type, 'study_id', p_study_id), true
  );
  
  RETURN jsonb_build_object('success', true, 'consent_id', v_consent_id);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.grant_consent(p_consent_type consent_type, p_study_id uuid, p_version text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_consent(p_consent_type consent_type, p_study_id uuid, p_version text) TO authenticated;
