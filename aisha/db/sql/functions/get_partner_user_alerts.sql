-- Function: public.get_partner_user_alerts
-- Arguments: p_partner_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_partner_user_alerts(p_partner_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, user_name text, alert_type text, message text, created_at timestamptz, study_name text)
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
      p_entity_type := 'notifications',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner viewing user health alerts',
      p_tags := ARRAY['phi','partner','alerts'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    n.id,
    n.user_id,
    COALESCE(pr.first_name || ' ' || pr.last_name, 'Unknown')::text as user_name,
    n.type as alert_type,
    n.message,
    n.created_at,
    COALESCE(s.title, '')::text as study_name
  FROM notifications n
  JOIN data_sharing_consents dsc ON dsc.user_id = n.user_id AND dsc.partner_id = p_partner_id
  LEFT JOIN profiles pr ON pr.id = n.user_id
  LEFT JOIN study_registrations se ON se.user_id = n.user_id
  LEFT JOIN studies s ON s.id = se.study_id
  WHERE dsc.revoked_at IS NULL
    AND n.type IN ('health_alert', 'lab_result', 'check_in_missed')
  ORDER BY n.created_at DESC
  LIMIT 50;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_partner_user_alerts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_user_alerts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_user_alerts(uuid) TO service_role;
