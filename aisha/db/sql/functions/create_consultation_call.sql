-- =============================================================================
-- create_consultation_call
-- =============================================================================
-- Creates voice room + consultation session atomically.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_consultation_call(
  p_booking_id uuid DEFAULT NULL,
  p_callee_id uuid DEFAULT NULL,
  p_livekit_room_name text DEFAULT NULL,
  p_recording_consent boolean DEFAULT false,
  p_room_name text DEFAULT NULL,
  p_story_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_session_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_callee_id IS NULL OR p_livekit_room_name IS NULL OR p_room_name IS NULL THEN
    RAISE EXCEPTION 'Missing required parameters';
  END IF;
  -- ⛔ Audit vydání 2026-10-01 (B2): hovor šel navázat na KTEROUKOLI story.
  -- Story je volitelná; když je uvedená, musí ji volající vidět.
  IF p_story_id IS NOT NULL AND NOT public.can_access_story(p_story_id) THEN
    RAISE EXCEPTION 'Access denied: story owner or participant required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO voice_rooms (name, room_type, story_id, livekit_room_name, max_participants, created_by)
  VALUES (p_room_name, 'consultation', p_story_id, p_livekit_room_name, 2, v_user_id)
  RETURNING id INTO v_room_id;

  INSERT INTO consultation_sessions (voice_room_id, booking_id, caller_id, callee_id, status, recording_consent)
  VALUES (v_room_id, p_booking_id, v_user_id, p_callee_id, 'ringing', p_recording_consent)
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'room_id', v_room_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_consultation_call(uuid, uuid, text, boolean, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_consultation_call(uuid, uuid, text, boolean, text, uuid) TO authenticated;
