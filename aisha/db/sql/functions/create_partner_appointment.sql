-- Function: public.create_partner_appointment
-- Arguments: p_partner_id uuid, p_member_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text, p_notes text, p_service text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:08+01:00

CREATE OR REPLACE FUNCTION public.create_partner_appointment(p_partner_id uuid, p_member_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text, p_notes text DEFAULT NULL::text, p_service text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  INSERT INTO partner_appointments (partner_id, member_id, appointment_date, start_time, end_time, appointment_type, notes, service)
  VALUES (p_partner_id, p_member_id, p_appointment_date, p_start_time, p_end_time, p_appointment_type, p_notes, p_service)
  RETURNING row_to_json(partner_appointments)::jsonb INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_partner_appointment(p_partner_id uuid, p_member_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text, p_notes text, p_service text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_partner_appointment(p_partner_id uuid, p_member_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text, p_notes text, p_service text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_partner_appointment(p_partner_id uuid, p_member_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text, p_notes text, p_service text) TO authenticated;
