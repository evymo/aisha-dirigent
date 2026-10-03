-- =============================================================================
-- set_participant_mute
-- =============================================================================
-- Update mute state for current user in a room.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_participant_mute(
  p_is_muted boolean DEFAULT NULL,
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
  SET is_muted = p_is_muted
  WHERE voice_room_id = p_voice_room_id
    AND user_id = v_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_participant_mute(boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_participant_mute(boolean, uuid) TO authenticated;
