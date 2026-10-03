-- Function: public.create_partner_appointment_audited
-- Arguments: p_partner_id uuid, p_member_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text, p_notes text, p_service text
-- Description: Create partner appointment with full audit trail for sensitive data compliance
-- Security: SECURITY DEFINER with audit logging
-- Extracted: 2026-01-11

CREATE OR REPLACE FUNCTION public.create_partner_appointment_audited(
  p_partner_id uuid,
  p_member_id uuid,
  p_appointment_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_appointment_type text,
  p_notes text DEFAULT NULL::text,
  p_service text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_appointment_id UUID;
BEGIN
  -- Authorization: member can book for themselves, or partner can create
  IF auth.uid() != p_member_id AND auth.uid() != (
    SELECT user_id FROM partner_profiles WHERE id = p_partner_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Cannot create appointment for another user' USING ERRCODE = '42501';
  END IF;

  -- Create the appointment
  INSERT INTO partner_appointments (partner_id, member_id, appointment_date, start_time, end_time, appointment_type, notes, service)
  VALUES (p_partner_id, p_member_id, p_appointment_date, p_start_time, p_end_time, p_appointment_type, p_notes, p_service)
  RETURNING id, row_to_json(partner_appointments)::jsonb INTO v_appointment_id, v_result;

  -- Audit log - record appointment creation without sensitive data content
  INSERT INTO audit_journal (user_id, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(),
    'create',
    'partner_appointment',
    v_appointment_id,
    jsonb_build_object(
      'partner_id', p_partner_id,
      'member_id', p_member_id,
      'appointment_date', p_appointment_date,
      'appointment_type', p_appointment_type
    )
  );

  RETURN v_result;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_partner_appointment_audited(uuid, uuid, date, time without time zone, time without time zone, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_partner_appointment_audited(uuid, uuid, date, time without time zone, time without time zone, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_partner_appointment_audited(uuid, uuid, date, time without time zone, time without time zone, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.create_partner_appointment_audited(uuid, uuid, date, time without time zone, time without time zone, text, text, text) IS 'Create partner appointment with full audit trail for sensitive data compliance';
