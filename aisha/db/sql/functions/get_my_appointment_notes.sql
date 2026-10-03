-- Function: public.get_my_appointment_notes
-- Arguments: p_appointment_ids uuid[]
-- Description: Get appointment notes for authenticated user's appointments only.
-- @security: authenticated
-- @audit: required
-- @phi: true
-- Extracted: 2026-01-08T18:26:52+01:00

CREATE OR REPLACE FUNCTION public.get_my_appointment_notes(p_appointment_ids uuid[])
 RETURNS TABLE(appointment_id uuid, notes text)
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
      p_area := 'appointments',
      p_details := jsonb_build_object('appointment_count', array_length(p_appointment_ids, 1)),
      p_entity_id := NULL,
      p_entity_type := 'partner_appointment_notes',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'User viewing own appointment notes',
      p_tags := ARRAY['phi','member','appointments'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT pan.appointment_id, pan.content AS notes
  FROM public.partner_appointment_notes pan
  JOIN public.partner_appointments pa ON pa.id = pan.appointment_id
  WHERE pan.appointment_id = ANY (p_appointment_ids)
    AND pa.member_id = v_user_id  -- Only own appointments
  ORDER BY pan.appointment_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_appointment_notes(p_appointment_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_appointment_notes(p_appointment_ids uuid[]) TO authenticated;
