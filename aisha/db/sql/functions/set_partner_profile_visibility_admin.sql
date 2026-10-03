-- Function: public.set_partner_profile_visibility_admin
-- Arguments: p_partner_profile_id uuid, p_is_visible boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:05+01:00

CREATE OR REPLACE FUNCTION public.set_partner_profile_visibility_admin(p_partner_profile_id uuid, p_is_visible boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated boolean := false;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.partner_profiles pp
  SET is_visible = p_is_visible
  WHERE pp.id = p_partner_profile_id;

  v_updated := FOUND;

  IF v_updated THEN
    PERFORM public.write_audit_journal(
        p_action_type := 'update'::public.journal_action_type,
        p_area := 'admin'::public.journal_area,
        p_details := jsonb_build_object('partner_profile_id', p_partner_profile_id, 'is_visible', p_is_visible),
        p_entity_id := p_partner_profile_id::text,
        p_entity_type := 'partner_profiles',
        p_new_values := NULL,
        p_old_values := NULL,
        p_severity := 'notice'::public.journal_severity,
        p_summary := 'Admin updated partner profile visibility',
        p_tags := ARRAY['admin', 'partners', 'visibility'],
        p_user_id := auth.uid()
    );
  END IF;

  RETURN v_updated;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.set_partner_profile_visibility_admin(p_partner_profile_id uuid, p_is_visible boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_partner_profile_visibility_admin(p_partner_profile_id uuid, p_is_visible boolean) TO authenticated;
