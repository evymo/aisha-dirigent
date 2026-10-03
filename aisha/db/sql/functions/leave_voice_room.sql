-- =============================================================================
-- leave_voice_room
-- =============================================================================
-- Mark current user as left from voice room.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.leave_voice_room(
  p_voice_room_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE call_participants
  SET left_at = now()
  WHERE voice_room_id = p_voice_room_id
    AND user_id = v_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.leave_voice_room(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_voice_room(uuid) TO authenticated;
