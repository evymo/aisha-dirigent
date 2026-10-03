-- Function: public.get_partner_available_slots
-- Arguments: p_partner_id uuid, p_start_date date, p_end_date date
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:10+01:00

CREATE OR REPLACE FUNCTION public.get_partner_available_slots(p_partner_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(id uuid, partner_id uuid, start_time time, end_time time, member_id uuid, appointment_type text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    pa.id,
    pa.partner_id,
    pa.start_time,
    pa.end_time,
    pa.member_id,
    pa.appointment_type,
    pa.status
  FROM public.partner_appointments pa
  WHERE pa.partner_id = p_partner_id
    AND pa.start_time::date >= p_start_date
    AND pa.start_time::date <= p_end_date
    AND pa.status NOT IN ('cancelled', 'rejected')
  ORDER BY pa.start_time;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_available_slots(p_partner_id uuid, p_start_date date, p_end_date date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_available_slots(p_partner_id uuid, p_start_date date, p_end_date date) TO authenticated;
