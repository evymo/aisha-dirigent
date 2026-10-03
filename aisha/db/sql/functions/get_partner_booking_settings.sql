CREATE OR REPLACE FUNCTION public.get_partner_booking_settings(
  p_partner_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_result jsonb;
BEGIN
  -- Authorization: caller must own this partner profile
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM partner_profiles
    WHERE id = p_partner_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: not your partner profile';
  END IF;

  SELECT jsonb_build_object(
    'buffer_minutes',        pp.buffer_minutes,
    'slot_duration_minutes', pp.slot_duration_minutes
  )
  INTO v_result
  FROM partner_profiles pp
  WHERE pp.id = p_partner_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_partner_booking_settings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_booking_settings(uuid) TO authenticated;
