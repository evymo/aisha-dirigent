-- Function: public.update_partner_appointment_status
-- Arguments: p_appointment_id uuid, p_status text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:22+01:00

CREATE OR REPLACE FUNCTION public.update_partner_appointment_status(p_appointment_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE partner_appointments
  SET status = p_status, updated_at = NOW()
  WHERE id = p_appointment_id
  RETURNING jsonb_build_object('id', id, 'status', status, 'updated_at', updated_at) INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_partner_appointment_status(p_appointment_id uuid, p_status text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_partner_appointment_status(p_appointment_id uuid, p_status text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_partner_appointment_status(p_appointment_id uuid, p_status text) TO authenticated;
