-- Function: public.submit_study_consent_acceptance
-- Arguments: p_study_id uuid, p_consent_template_id uuid, p_granted boolean, p_signature_data text, p_ip_address inet
-- Description: Submit user acceptance of a study consent requirement.
-- Security: SECURITY DEFINER, authenticated users only
-- Updated: 2026-01-09 - Added p_ip_address param for audit trail

CREATE OR REPLACE FUNCTION public.submit_study_consent_acceptance(
  p_study_id uuid, 
  p_consent_template_id uuid, 
  p_granted boolean DEFAULT true,
  p_signature_data text DEFAULT NULL,
  p_ip_address inet DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_requirement public.study_consent_requirements%ROWTYPE;
  v_template public.consent_templates%ROWTYPE;
  v_acceptance_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_study_id IS NULL OR p_consent_template_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing parameters');
  END IF;

  -- If not granted, we don't record acceptance
  IF NOT COALESCE(p_granted, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Consent not granted');
  END IF;

  SELECT * INTO v_requirement
  FROM public.study_consent_requirements
  WHERE study_id = p_study_id
    AND consent_template_id = p_consent_template_id
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Consent requirement not found');
  END IF;

  SELECT * INTO v_template
  FROM public.consent_templates
  WHERE id = p_consent_template_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Consent template not found');
  END IF;

  -- Integrity guards (evidence must be trustworthy):
  -- 1) the template must currently be active (no accepting a retired/pre-ratified version).
  IF NOT v_template.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Consent template is not active');
  END IF;

  -- 2) if this template requires a signature, a non-empty signature is mandatory —
  --    a signature-required consent must never be recorded with a NULL/blank pad.
  IF v_template.requires_signature AND COALESCE(btrim(p_signature_data), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Signature required');
  END IF;

  -- 3) enforce the requirement's validity window (if set) against now().
  IF v_requirement.valid_from IS NOT NULL AND now() < v_requirement.valid_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'Consent requirement not yet valid');
  END IF;
  IF v_requirement.valid_until IS NOT NULL AND now() > v_requirement.valid_until THEN
    RETURN jsonb_build_object('success', false, 'error', 'Consent requirement has expired');
  END IF;

  INSERT INTO public.study_consent_acceptances (
    user_id, study_id, consent_template_id, consent_template_version,
    granted_at, signature_data, ip_address
  ) VALUES (
    v_user_id, p_study_id, p_consent_template_id, 
    -- Convert "1.0" text version to integer (extract major version number)
    floor(v_requirement.consent_template_version::numeric)::integer,
    now(), p_signature_data, p_ip_address
  )
  ON CONFLICT (user_id, study_id, consent_template_id, consent_template_version)
  DO UPDATE SET
    granted_at = EXCLUDED.granted_at,
    revoked_at = NULL,
    -- Immutable-once-set: keep the originally recorded signature; only fill if it was
    -- NULL. A signed acceptance must not be silently overwritten by a re-grant of the
    -- same template version (a genuinely new signature belongs to a new version).
    signature_data = COALESCE(public.study_consent_acceptances.signature_data, EXCLUDED.signature_data),
    ip_address = COALESCE(public.study_consent_acceptances.ip_address, EXCLUDED.ip_address)
  RETURNING id INTO v_acceptance_id;

  IF v_template.consent_type IS NOT NULL THEN
    INSERT INTO public.consents (
      user_id,
      study_id,
      consent_type,
      granted,
      granted_at,
      revoked_at,
      signature_data,
      document_url,
      version,
      ip_address
    ) VALUES (
      v_user_id,
      p_study_id,
      v_template.consent_type,
      true,
      now(),
      NULL,
      p_signature_data,
      v_template.document_url,
      v_requirement.consent_template_version::text,
      p_ip_address
    )
    ON CONFLICT (user_id, consent_type, study_id)
    DO UPDATE SET
      granted = true,
      granted_at = now(),
      revoked_at = NULL,
      -- Immutable-once-set (mirror of the acceptances guard above).
      signature_data = COALESCE(public.consents.signature_data, EXCLUDED.signature_data),
      document_url = COALESCE(EXCLUDED.document_url, public.consents.document_url),
      version = EXCLUDED.version,
      ip_address = COALESCE(public.consents.ip_address, EXCLUDED.ip_address);
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'consents'::journal_area,
      p_details := jsonb_build_object(
      'study_id', p_study_id,
      'consent_template_id', p_consent_template_id,
      'has_ip_address', p_ip_address IS NOT NULL
    ),
      p_entity_id := v_acceptance_id::text,
      p_entity_type := 'consent',
      p_severity := 'info'::journal_severity,
      p_summary := 'User granted study consent',
    p_user_id := v_user_id
  );

  RETURN jsonb_build_object('success', true, 'id', v_acceptance_id, 'version', v_requirement.consent_template_version);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_study_consent_acceptance(uuid, uuid, boolean, text, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_study_consent_acceptance(uuid, uuid, boolean, text, inet) TO authenticated;
