-- Function: public.get_partner_appointment_notes
-- Arguments: p_appointment_id uuid
-- Description: Get appointment notes with authorization check.
-- Security: SECURITY DEFINER - only member or partner of appointment can access.
-- @audit: required
-- @phi: true

CREATE OR REPLACE FUNCTION public.get_partner_appointment_notes(p_appointment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_notes text;
  v_appointment record;
BEGIN
  -- Get appointment and verify authorization
  SELECT pa.notes, pa.member_id, pp.user_id AS partner_user_id
  INTO v_appointment
  FROM partner_appointments pa
  JOIN partner_profiles pp ON pp.id = pa.partner_id
  WHERE pa.id = p_appointment_id;
  
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  
  -- Check authorization: must be member or partner of appointment
  IF v_user_id IS NULL OR (v_user_id != v_appointment.member_id AND v_user_id != v_appointment.partner_user_id) THEN
    RAISE EXCEPTION 'Not authorized to view appointment notes';
  END IF;
  
  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'partner',
      p_details := jsonb_build_object('appointment_id', p_appointment_id),
      p_entity_id := NULL,
      p_entity_type := 'partner_appointment_notes',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Viewed appointment notes',
      p_tags := ARRAY['phi', 'appointment', 'notes'],
      p_user_id := v_user_id
  );
  
  RETURN v_appointment.notes;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_appointment_notes(p_appointment_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_appointment_notes(p_appointment_id uuid) TO authenticated;
