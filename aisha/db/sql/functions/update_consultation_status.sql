-- =============================================================================
-- update_consultation_status
-- =============================================================================
-- Handles all status transitions (active/declined/ended/missed).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_consultation_status(
  p_duration_seconds integer DEFAULT NULL,
  p_session_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_voice_room_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_session_id IS NULL OR p_status IS NULL THEN
    RAISE EXCEPTION 'Missing required parameters';
  END IF;

  -- Verify caller or callee
  SELECT voice_room_id INTO v_voice_room_id
  FROM consultation_sessions
  WHERE id = p_session_id
    AND (caller_id = v_user_id OR callee_id = v_user_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or not authorized';
  END IF;

  IF p_status = 'active' THEN
    UPDATE consultation_sessions
    SET status = 'active', started_at = now()
    WHERE id = p_session_id;

  ELSIF p_status = 'declined' THEN
    UPDATE consultation_sessions
    SET status = 'declined', ended_at = now()
    WHERE id = p_session_id;

  ELSIF p_status IN ('ended', 'missed') THEN
    UPDATE consultation_sessions
    SET status = p_status,
        ended_at = now(),
        duration_seconds = COALESCE(p_duration_seconds, 0)
    WHERE id = p_session_id;

    -- Deactivate voice room
    UPDATE voice_rooms
    SET is_active = false
    WHERE id = v_voice_room_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_consultation_status(integer, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_consultation_status(integer, uuid, text) TO authenticated;
