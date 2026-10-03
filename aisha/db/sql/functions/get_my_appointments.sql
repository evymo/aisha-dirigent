-- Function: public.get_my_appointments
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:52+01:00

CREATE OR REPLACE FUNCTION public.get_my_appointments()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', pa.id,
    'partner_id', pa.partner_id,
    'member_id', pa.member_id,
    'appointment_date', pa.appointment_date,
    'start_time', pa.start_time,
    'end_time', pa.end_time,
    'appointment_type', pa.appointment_type,
    'status', pa.status,
    'service', pa.service,
    'created_at', pa.created_at,
    'updated_at', pa.updated_at,
    'partner', jsonb_build_object(
      'display_name', pp.display_name,
      'business_name', pp.business_name,
      'city', pp.city
    )
  ) ORDER BY pa.appointment_date)
  INTO v_result
  FROM partner_appointments pa
  LEFT JOIN partner_profiles pp ON pp.id = pa.partner_id
  WHERE pa.member_id = v_user_id;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_appointments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_appointments() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_appointments() TO authenticated;
