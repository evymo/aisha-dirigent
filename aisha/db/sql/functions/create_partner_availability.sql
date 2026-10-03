-- Function: public.create_partner_availability
-- Arguments: p_data jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:08+01:00

CREATE OR REPLACE FUNCTION public.create_partner_availability(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id UUID;
BEGIN
  -- Get partner profile for current user
  SELECT id INTO v_partner_id
  FROM partner_profiles
  WHERE user_id = auth.uid();

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a partner');
  END IF;

  INSERT INTO partner_availability (
    partner_id,
    day_of_week,
    start_time,
    end_time,
    is_online
  ) VALUES (
    v_partner_id,
    (p_data->>'day_of_week')::INTEGER,
    (p_data->>'start_time')::TIME,
    (p_data->>'end_time')::TIME,
    COALESCE((p_data->>'is_available')::BOOLEAN, true)
  );

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_partner_availability(p_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_partner_availability(p_data jsonb) TO authenticated;
