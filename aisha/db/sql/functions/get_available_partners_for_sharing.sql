-- Function: public.get_available_partners_for_sharing
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:39+01:00

CREATE OR REPLACE FUNCTION public.get_available_partners_for_sharing()
 RETURNS TABLE(id uuid, display_name text, business_name text, city text, certification_level text, has_consent boolean)
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

  -- Audit log for consent check
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'member',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'data_sharing_consents',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewing available partners for sharing',
      p_tags := ARRAY['phi','member','consent'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    pp.id,
    pp.display_name,
    pp.business_name,
    pp.city,
    pp.certification_level,
    EXISTS(
      SELECT 1 FROM public.data_sharing_consents dsc
      WHERE dsc.user_id = v_user_id
        AND dsc.partner_id = pp.id
        AND dsc.revoked_at IS NULL
    ) AS has_consent
  FROM public.partner_profiles pp
  WHERE pp.certification_passed_at IS NOT NULL
    AND pp.is_accepting_clients = true
  ORDER BY pp.display_name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_available_partners_for_sharing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_partners_for_sharing() TO authenticated;
