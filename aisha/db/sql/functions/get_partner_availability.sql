-- Function: public.get_partner_availability
-- Arguments: p_partner_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:10+01:00

CREATE OR REPLACE FUNCTION public.get_partner_availability(p_partner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'id', pa.id,
    'partner_id', pa.partner_id,
    'day_of_week', pa.day_of_week,
    'start_time', pa.start_time,
    'end_time', pa.end_time,
    'is_online', pa.is_online,
    'created_at', pa.created_at
  ) ORDER BY pa.day_of_week, pa.start_time)
  INTO v_result
  FROM partner_availability pa
  WHERE pa.partner_id = p_partner_id;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_availability(p_partner_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_partner_availability(p_partner_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_availability(p_partner_id uuid) TO authenticated;
