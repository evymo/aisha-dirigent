-- Function: public.add_partner_availability
-- Arguments: p_partner_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_is_online boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:50+01:00

CREATE OR REPLACE FUNCTION public.add_partner_availability(p_partner_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_is_online boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_id uuid;
  v_user_id uuid;
BEGIN
  -- Verify partner owns this profile
  SELECT user_id INTO v_user_id
  FROM partner_profiles
  WHERE id = p_partner_id;
  
  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this partner availability';
  END IF;
  
  INSERT INTO partner_availability (partner_id, day_of_week, start_time, end_time, is_online)
  VALUES (p_partner_id, p_day_of_week, p_start_time, p_end_time, p_is_online)
  RETURNING id INTO v_new_id;
  
  RETURN v_new_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.add_partner_availability(p_partner_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_is_online boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_partner_availability(p_partner_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_is_online boolean) TO authenticated;
