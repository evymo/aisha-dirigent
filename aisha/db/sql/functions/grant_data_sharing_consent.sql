-- Function: public.grant_data_sharing_consent
-- Arguments: p_partner_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:49+01:00

CREATE OR REPLACE FUNCTION public.grant_data_sharing_consent(p_partner_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_consent_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check if consent already exists
  SELECT id INTO v_consent_id
  FROM data_sharing_consents
  WHERE user_id = v_user_id
    AND partner_id = p_partner_id
    AND revoked_at IS NULL;
  
  IF v_consent_id IS NOT NULL THEN
    -- Already has active consent
    RETURN v_consent_id;
  END IF;
  
  -- Insert new consent
  INSERT INTO data_sharing_consents (
    user_id,
    partner_id,
    granted_at
  ) VALUES (
    v_user_id,
    p_partner_id,
    NOW()
  )
  RETURNING id INTO v_consent_id;
  
  -- Log to audit journal
  PERFORM public.write_audit_journal(
      p_action_type := 'consent_granted'::journal_action_type,
      p_area := 'consents'::journal_area,
      p_entity_id := 'Data sharing consent granted',
      p_entity_type := 'data_sharing_consent',
      p_severity := 'info'::journal_severity,
      p_summary := v_consent_id::text,
    p_user_id := v_user_id
  );
  
  RETURN v_consent_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.grant_data_sharing_consent(p_partner_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_data_sharing_consent(p_partner_id uuid) TO authenticated;
