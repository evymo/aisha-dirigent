-- Function: public.grant_data_sharing_consent_by_id
-- Arguments: p_consent_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:49+01:00

CREATE OR REPLACE FUNCTION public.grant_data_sharing_consent_by_id(p_consent_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_consent_user_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Verify the consent belongs to the current user
  SELECT user_id INTO v_consent_user_id
  FROM data_sharing_consents
  WHERE id = p_consent_id;
  
  IF v_consent_user_id IS NULL THEN
    RAISE EXCEPTION 'Consent not found';
  END IF;
  
  IF v_consent_user_id != v_user_id THEN
    RAISE EXCEPTION 'Unauthorized: Consent does not belong to current user';
  END IF;
  
  -- Re-grant the consent (clear revoked_at, set new granted_at)
  UPDATE data_sharing_consents
  SET revoked_at = NULL,
      granted_at = NOW(),
      expires_at = NOW() + INTERVAL '1 year',
      updated_at = NOW()
  WHERE id = p_consent_id;
  
  -- Log to audit journal
  PERFORM public.write_audit_journal(
      p_action_type := 'consent_granted'::journal_action_type,
      p_area := 'consents'::journal_area,
      p_entity_id := 'Data sharing consent re-granted',
      p_entity_type := 'data_sharing_consent',
      p_severity := 'info'::journal_severity,
      p_summary := p_consent_id::text,
    p_user_id := v_user_id
  );
  
  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.grant_data_sharing_consent_by_id(p_consent_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_data_sharing_consent_by_id(p_consent_id uuid) TO authenticated;
