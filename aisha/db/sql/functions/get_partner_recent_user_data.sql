-- Function: public.get_partner_recent_user_data
-- Arguments: p_partner_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_partner_recent_user_data(p_partner_id uuid)
 RETURNS TABLE(user_id uuid, user_name text, data_type text, data_value jsonb, recorded_at timestamp with time zone)
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

  IF NOT EXISTS (SELECT 1 FROM partner_profiles WHERE partner_profiles.id = p_partner_id AND partner_profiles.user_id = v_user_id) THEN
    RAISE EXCEPTION 'Partner profile not found or access denied';
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'partner',
      p_details := jsonb_build_object('partner_id', p_partner_id),
      p_entity_id := NULL,
      p_entity_type := 'health_check_ins',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner viewing user health data',
      p_tags := ARRAY['phi','partner','health_data'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    hci.user_id,
    COALESCE(pr.first_name || ' ' || pr.last_name, 'Unknown')::text as user_name,
    'check_in'::text as data_type,
    jsonb_build_object(
      'pain_level', hci.pain_level,
      'energy_level', hci.energy_level,
      'mood_level', hci.mood_level,
      'sleep_quality', hci.sleep_quality
    ) as data_value,
    hci.created_at as recorded_at
  FROM health_check_ins hci
  JOIN data_sharing_consents dsc ON dsc.user_id = hci.user_id AND dsc.partner_id = p_partner_id
  LEFT JOIN profiles pr ON pr.id = hci.user_id
  WHERE dsc.revoked_at IS NULL
  ORDER BY hci.created_at DESC
  LIMIT 100;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_partner_recent_user_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_recent_user_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_recent_user_data(uuid) TO service_role;
