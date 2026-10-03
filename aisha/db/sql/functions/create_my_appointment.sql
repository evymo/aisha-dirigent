-- Function: public.create_my_appointment
-- Arguments: p_partner_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text, p_notes text, p_service text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:06+01:00

CREATE OR REPLACE FUNCTION public.create_my_appointment(p_partner_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text DEFAULT 'consultation'::text, p_notes text DEFAULT NULL::text, p_service text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO partner_appointments (
    partner_id,
    member_id,
    appointment_date,
    start_time,
    end_time,
    appointment_type,
    notes,
    service,
    status
  ) VALUES (
    p_partner_id,
    v_user_id,
    p_appointment_date,
    p_start_time,
    p_end_time,
    p_appointment_type,
    p_notes,
    p_service,
    'pending'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_my_appointment(p_partner_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text, p_notes text, p_service text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_my_appointment(p_partner_id uuid, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_appointment_type text, p_notes text, p_service text) TO authenticated;
