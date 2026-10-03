-- Function: public.get_my_assigned_clients
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:53+01:00

CREATE OR REPLACE FUNCTION public.get_my_assigned_clients()
 RETURNS TABLE(onboarding_id uuid, user_id uuid, display_name text, overall_feeling integer, energy_perception integer, primary_concern text, main_goal text, phone_call_scheduled_at timestamptz, phone_call_completed_at timestamptz, onboarding_completed boolean, has_data_sharing_consent boolean, consent_status text, assigned_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_partner_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Get partner profile ID for current user
  SELECT pp.id INTO v_partner_id
  FROM partner_profiles pp
  WHERE pp.user_id = v_user_id;

  IF v_partner_id IS NULL THEN
    RETURN;
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'partner',
      p_details := jsonb_build_object('partner_id', v_partner_id),
      p_entity_id := NULL,
      p_entity_type := 'onboarding_responses',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner viewing assigned clients',
      p_tags := ARRAY['phi','partner','clients'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    o.id as onboarding_id,
    o.user_id,
    p.display_name,
    o.overall_feeling,
    o.energy_perception,
    o.primary_concern,
    o.main_goal,
    o.phone_call_scheduled_at,
    o.phone_call_completed_at,
    o.onboarding_completed,
    COALESCE(dsc.granted_at IS NOT NULL AND dsc.revoked_at IS NULL, false) as has_data_sharing_consent,
    CASE 
      WHEN dsc.revoked_at IS NOT NULL THEN 'revoked'
      WHEN dsc.expires_at < now() THEN 'expired'
      WHEN dsc.granted_at IS NOT NULL THEN 'granted'
      WHEN dsc.consent_requested_at IS NOT NULL THEN 'pending'
      ELSE 'none'
    END as consent_status,
    o.created_at as assigned_at
  FROM onboarding_responses o
  JOIN profiles p ON p.user_id = o.user_id
  LEFT JOIN data_sharing_consents dsc ON dsc.user_id = o.user_id AND dsc.partner_id = v_partner_id
  WHERE o.assigned_partner_id = v_partner_id
  ORDER BY o.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_assigned_clients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_assigned_clients() TO authenticated;
