-- Function: public.get_partner_recent_check_ins_audited
-- Arguments: p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:14+01:00

CREATE OR REPLACE FUNCTION public.get_partner_recent_check_ins_audited(p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, user_id uuid, display_name text, check_in_date timestamp with time zone, pain_level integer, energy_level integer, mood_level integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_partner_id UUID;
BEGIN
  -- Get partner_id using explicit table alias
  SELECT pp.id INTO v_partner_id 
  FROM partner_profiles pp 
  WHERE pp.user_id = v_caller_id;
  
  IF v_partner_id IS NULL AND NOT public.is_admin_or_staff(v_caller_id) THEN
    RAISE EXCEPTION 'Unauthorized: must be partner or admin/staff';
  END IF;

  -- AUDIT LOG (was missing!)
  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'partners'::journal_area,
      p_details := jsonb_build_object('limit', p_limit, 'partner_id', v_partner_id),
      p_entity_id := NULL,
      p_entity_type := 'health_check_ins',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'Partner viewed recent check-ins',
      p_tags := ARRAY['partner', 'phi', 'check_ins'],
      p_user_id := v_caller_id
  );

  RETURN QUERY
  SELECT 
    hci.id,
    hci.user_id,
    p.display_name,
    hci.check_in_date,
    hci.pain_level,
    hci.energy_level,
    hci.mood_level
  FROM health_check_ins hci
  JOIN profiles p ON p.user_id = hci.user_id
  JOIN data_sharing_consents dsc ON dsc.user_id = hci.user_id 
    AND dsc.partner_id = v_partner_id 
    AND dsc.revoked_at IS NULL
  ORDER BY hci.check_in_date DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_recent_check_ins_audited(p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_partner_recent_check_ins_audited(p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_recent_check_ins_audited(p_limit integer) TO authenticated;
