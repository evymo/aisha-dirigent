-- Function: public.get_consented_users
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_consented_users()
 RETURNS SETOF text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_partner_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Get partner profile id for this user
  SELECT id INTO v_partner_id
  FROM partner_profiles
  WHERE user_id = v_user_id
  LIMIT 1;
  
  IF v_partner_id IS NULL THEN
    RETURN;
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'partner',
      p_details := jsonb_build_object('partner_id', v_partner_id),
      p_entity_id := NULL,
      p_entity_type := 'data_sharing_consents',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner viewing consented users list',
      p_tags := ARRAY['phi','partner','consent'],
      p_user_id := v_user_id
  );
  
  -- Return user_ids as text array
  RETURN QUERY
  SELECT dsc.user_id::text
  FROM data_sharing_consents dsc
  WHERE dsc.partner_id = v_partner_id
    AND dsc.revoked_at IS NULL
    AND (dsc.expires_at IS NULL OR dsc.expires_at > NOW())
  ORDER BY 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_consented_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consented_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_consented_users() TO service_role;
