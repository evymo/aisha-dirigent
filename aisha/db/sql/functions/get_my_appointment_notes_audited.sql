-- Function: public.get_my_appointment_notes_audited
-- Arguments: p_appointment_ids uuid[]
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:52+01:00

CREATE OR REPLACE FUNCTION public.get_my_appointment_notes_audited(p_appointment_ids uuid[])
 RETURNS TABLE(appointment_id uuid, notes text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_requested_count integer := COALESCE(array_length(p_appointment_ids, 1), 0);
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'appointments',
      p_details := jsonb_build_object('result', 'granted', 'requested_count', v_requested_count),
      p_entity_id := NULL,
      p_entity_type := 'partner_appointment_notes',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member accessed appointment notes (bulk)',
      p_tags := ARRAY['phi','member','appointments','notes'],
      p_user_id := v_uid
  );

  RETURN QUERY
    SELECT pan.appointment_id, pan.content AS notes
    FROM public.partner_appointment_notes pan
    JOIN public.partner_appointments pa
      ON pa.id = pan.appointment_id
    WHERE pa.member_id = v_uid
      AND pan.appointment_id = ANY (p_appointment_ids)
    ORDER BY pan.appointment_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_appointment_notes_audited(p_appointment_ids uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_appointment_notes_audited(p_appointment_ids uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_appointment_notes_audited(p_appointment_ids uuid[]) TO authenticated;
