-- Function: public.update_partner_availability_slot
-- Arguments: p_availability_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_is_online boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:23+01:00

CREATE OR REPLACE FUNCTION public.update_partner_availability_slot(p_availability_id uuid, p_day_of_week integer DEFAULT NULL::integer, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_is_online boolean DEFAULT NULL::boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  -- Verify user owns the partner profile linked to this availability
  SELECT pp.user_id INTO v_user_id
  FROM partner_availability pa
  JOIN partner_profiles pp ON pp.id = pa.partner_id
  WHERE pa.id = p_availability_id;
  
  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to update this availability';
  END IF;
  
  UPDATE partner_availability
  SET
    day_of_week = COALESCE(p_day_of_week, day_of_week),
    start_time = COALESCE(p_start_time, start_time),
    end_time = COALESCE(p_end_time, end_time),
    is_online = COALESCE(p_is_online, is_online)
  WHERE id = p_availability_id;
  
  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_partner_availability_slot(p_availability_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_is_online boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_partner_availability_slot(p_availability_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_is_online boolean) TO authenticated;
