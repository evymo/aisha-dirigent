-- Function: public.get_consent_status
-- Arguments: p_user_id uuid, p_partner_user_id uuid
-- Description: Returns consent status between user and partner.
-- Security: SECURITY DEFINER with search_path set.
-- Authorization: Caller must be either the user or the partner.
-- Extracted: 2026-01-08T18:26:43+01:00

CREATE OR REPLACE FUNCTION public.get_consent_status(p_user_id uuid, p_partner_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_status text;
BEGIN
  -- Authorization: caller must be the user or the partner
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  IF v_caller != p_user_id AND v_caller != p_partner_user_id THEN
    RAISE EXCEPTION 'Access denied: you can only check consent status for yourself';
  END IF;

  -- Audit log for consent status check
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'consent',
      p_details := jsonb_build_object('user_id', p_user_id, 'partner_user_id', p_partner_user_id),
      p_entity_id := NULL,
      p_entity_type := 'data_sharing_consents',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Checking consent status',
      p_tags := ARRAY['phi','consent'],
      p_user_id := v_caller
  );

  SELECT 
    CASE
      WHEN dsc.revoked_at IS NOT NULL THEN 'revoked'
      WHEN dsc.granted_at IS NOT NULL AND dsc.expires_at IS NOT NULL AND dsc.expires_at < NOW() THEN 'expired'
      WHEN dsc.granted_at IS NOT NULL THEN 'granted'
      WHEN dsc.consent_requested_at IS NOT NULL THEN 'pending'
      ELSE 'none'
    END
  INTO v_status
  FROM data_sharing_consents dsc
  JOIN partner_profiles pp ON pp.id = dsc.partner_id
  WHERE dsc.user_id = p_user_id
    AND pp.user_id = p_partner_user_id
  ORDER BY dsc.consent_requested_at DESC NULLS LAST
  LIMIT 1;
  
  RETURN COALESCE(v_status, 'none');
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_consent_status(p_user_id uuid, p_partner_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consent_status(p_user_id uuid, p_partner_user_id uuid) TO authenticated;
