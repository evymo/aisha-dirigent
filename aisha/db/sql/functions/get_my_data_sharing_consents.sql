-- Function: public.get_my_data_sharing_consents
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:55+01:00

CREATE OR REPLACE FUNCTION public.get_my_data_sharing_consents()
 RETURNS TABLE(id uuid, user_id uuid, partner_id uuid, granted_at timestamptz, revoked_at timestamptz, created_at timestamptz, updated_at timestamptz, partner_name text, partner_email text, consent_requested_at timestamptz, expires_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'consent',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'data_sharing_consents',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'View own data sharing consents',
      p_tags := ARRAY['phi','member','consent'],
      p_user_id := v_user_id
  );
  
  RETURN QUERY
  SELECT 
    dsc.id,
    dsc.user_id,
    dsc.partner_id,
    dsc.granted_at,
    dsc.revoked_at,
    dsc.created_at,
    dsc.updated_at,
    pp.display_name,
    (SELECT email FROM aisha_auth.users au WHERE au.id = pp.user_id),
    dsc.consent_requested_at,
    dsc.expires_at
  FROM data_sharing_consents dsc
  JOIN partner_profiles pp ON pp.id = dsc.partner_id
  WHERE dsc.user_id = v_user_id
  ORDER BY dsc.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_data_sharing_consents() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_data_sharing_consents() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_data_sharing_consents() TO authenticated;
