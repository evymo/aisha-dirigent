-- Function: public.update_study_registration_status_admin
-- Arguments: p_registration_id uuid, p_status text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.update_study_registration_status_admin(p_registration_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Check if user is admin or staff
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Validate status
  IF p_status NOT IN ('screening', 'enrolled', 'active', 'completed', 'withdrawn') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid status: %s', p_status), ERRCODE = '22023';
  END IF;

  UPDATE study_registrations
  SET 
    status = p_status::registration_status,
    enrolled_at = CASE WHEN p_status = 'enrolled' AND enrolled_at IS NULL THEN now() ELSE enrolled_at END,
    updated_at = now()
  WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found: %', p_registration_id;
  END IF;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_registration_id::text,
      p_entity_type := 'study_registration_status',
      p_new_values := jsonb_build_object('registration_id', p_registration_id, 'status', p_status),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated study registration status',
      p_tags := ARRAY['admin', 'study_registration_status', 'update'],
      p_user_id := auth.uid()
  );

END;
$function$;

REVOKE ALL ON FUNCTION public.update_study_registration_status_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_study_registration_status_admin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_study_registration_status_admin(uuid, text) TO service_role;
