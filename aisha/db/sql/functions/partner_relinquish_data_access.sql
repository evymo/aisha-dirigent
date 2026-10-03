-- Function: public.partner_relinquish_data_access
-- Arguments: p_user_id uuid, p_reason text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:58+01:00

CREATE OR REPLACE FUNCTION public.partner_relinquish_data_access(p_user_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_user_id uuid := auth.uid();
  v_partner_id uuid;
  v_consent_id uuid;
BEGIN
  -- Get partner_id
  SELECT pp.id INTO v_partner_id 
  FROM partner_profiles pp 
  WHERE pp.user_id = v_partner_user_id;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be a partner';
  END IF;

  -- Find and revoke consent
  SELECT dsc.id INTO v_consent_id
  FROM data_sharing_consents dsc
  WHERE dsc.user_id = p_user_id 
    AND dsc.partner_id = v_partner_id
    AND dsc.revoked_at IS NULL;

  IF v_consent_id IS NULL THEN
    RAISE EXCEPTION 'No active consent found for this user';
  END IF;

  -- Revoke the consent
  UPDATE data_sharing_consents dsc SET
    revoked_at = NOW(),
    revoked_by = v_partner_user_id
  WHERE dsc.id = v_consent_id;

  -- Audit log using correct function signature
  PERFORM public.write_audit_journal(
      p_action_type := 'update',
      p_area := 'consents',
      p_details := jsonb_build_object(
      'target_user_id', p_user_id,
      'partner_id', v_partner_id,
      'reason', COALESCE(p_reason, 'Partner voluntarily relinquished data access')
    ),
      p_entity_id := v_consent_id::text,
      p_entity_type := 'data_sharing_consents',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner relinquished data access',
      p_tags := ARRAY['consents', 'partner', 'relinquish'],
      p_user_id := v_partner_user_id
  );

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.partner_relinquish_data_access(p_user_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_relinquish_data_access(p_user_id uuid, p_reason text) TO authenticated;
