CREATE OR REPLACE FUNCTION public.update_partner_booking_settings(
  p_buffer_minutes integer,
  p_partner_id uuid,
  p_slot_duration_minutes integer
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
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

  -- Validate ranges (DB constraints also enforce this)
  IF p_slot_duration_minutes < 10 OR p_slot_duration_minutes > 240 THEN
    RAISE EXCEPTION 'slot_duration_minutes must be between 10 and 240';
  END IF;

  IF p_buffer_minutes < 0 OR p_buffer_minutes > 60 THEN
    RAISE EXCEPTION 'buffer_minutes must be between 0 and 60';
  END IF;

  UPDATE partner_profiles
  SET
    buffer_minutes = p_buffer_minutes,
    slot_duration_minutes = p_slot_duration_minutes,
    updated_at = now()
  WHERE id = p_partner_id
    AND user_id = v_user_id;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'PARTNER_BOOKING_SETTINGS_UPDATE',
    jsonb_build_object(
      'area', 'partner',
      'severity', 'info',
      'partner_id', p_partner_id,
      'slot_duration_minutes', p_slot_duration_minutes,
      'buffer_minutes', p_buffer_minutes
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_partner_booking_settings(integer, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_partner_booking_settings(integer, uuid, integer) TO authenticated;
