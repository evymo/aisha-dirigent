-- Function: public.get_public_partner_booked_slots
-- Arguments: p_partner_id uuid, p_date date
-- Description: Public/member-safe booked appointment time slots for partner booking UI.
-- Security: SECURITY DEFINER (public read of non-sensitive data slot metadata only)
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_public_partner_booked_slots(
  p_partner_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'start_time', pa.start_time,
      'end_time', pa.end_time
    )
    ORDER BY pa.start_time
  )
  INTO v_result
  FROM public.partner_appointments pa
  WHERE pa.partner_id = p_partner_id
    AND pa.appointment_date = p_date
    AND pa.status != 'cancelled';

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_partner_booked_slots(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_partner_booked_slots(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_partner_booked_slots(uuid, date) TO authenticated;
