-- =============================================================================
-- update_recording_consent_audited
-- =============================================================================
-- Grant/revoke recording consent with audit journal entry.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_recording_consent_audited(
  p_consent boolean DEFAULT NULL,
  p_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_session_id IS NULL OR p_consent IS NULL THEN
    RAISE EXCEPTION 'Missing required parameters';
  END IF;

  -- Verify participant
  IF NOT EXISTS (
    SELECT 1 FROM consultation_sessions
    WHERE id = p_session_id
      AND (caller_id = v_user_id OR callee_id = v_user_id)
  ) THEN
    RAISE EXCEPTION 'Session not found or not authorized';
  END IF;

  UPDATE consultation_sessions
  SET recording_consent = p_consent,
      recording_consent_at = CASE WHEN p_consent THEN now() ELSE NULL END
  WHERE id = p_session_id;

  -- Audit journal (GDPR requirement)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    CASE WHEN p_consent THEN 'RECORDING_CONSENT_GRANTED' ELSE 'RECORDING_CONSENT_REVOKED' END,
    jsonb_build_object(
      'area', 'recording',
      'severity', 'info',
      'entity_type', 'consultation_session',
      'entity_id', p_session_id
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_recording_consent_audited(boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_recording_consent_audited(boolean, uuid) TO authenticated;
