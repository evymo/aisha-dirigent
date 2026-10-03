-- Function: public.delete_partner_profile_admin
-- Arguments: p_partner_profile_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:23+01:00

CREATE OR REPLACE FUNCTION public.delete_partner_profile_admin(p_partner_profile_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_deleted boolean := false;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT pp.user_id
  INTO v_user_id
  FROM public.partner_profiles pp
  WHERE pp.id = p_partner_profile_id;

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Best-effort cleanup of certification records
  DELETE FROM public.partner_certifications pc
  WHERE pc.user_id = v_user_id;

  DELETE FROM public.partner_profiles pp
  WHERE pp.id = p_partner_profile_id;

  v_deleted := FOUND;

  IF v_deleted THEN
    PERFORM public.write_audit_journal(
        p_action_type := 'delete'::public.journal_action_type,
        p_area := 'admin'::public.journal_area,
        p_details := jsonb_build_object('partner_profile_id', p_partner_profile_id),
        p_entity_id := p_partner_profile_id::text,
        p_entity_type := 'partner_profiles',
        p_new_values := NULL,
        p_old_values := NULL,
        p_severity := 'warning'::public.journal_severity,
        p_summary := 'Admin deleted partner profile',
        p_tags := ARRAY['admin', 'partners', 'delete'],
        p_user_id := auth.uid()
    );
  END IF;

  RETURN v_deleted;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_partner_profile_admin(p_partner_profile_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_partner_profile_admin(p_partner_profile_id uuid) TO authenticated;
