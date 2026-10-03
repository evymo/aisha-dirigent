-- =============================================================================
-- join_ptt_channel
-- =============================================================================
-- Find-or-create PTT room + upsert self as participant.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.join_ptt_channel(
  p_livekit_room_name text DEFAULT NULL,
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
  v_room_livekit_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_story_id IS NULL OR p_livekit_room_name IS NULL OR p_room_name IS NULL THEN
    RAISE EXCEPTION 'Missing required parameters';
  END IF;
  -- ⛔ Audit vydání 2026-10-01 (B2): kdokoli přihlášený se zapsal do PTT kanálu
  -- cizí story (a když žádný nebyl, rovnou ho založil). Poslouchat smí každý,
  -- kdo story vidí; založit kanál jen ten, kdo do ní smí psát (role ≠ viewer).
  IF NOT public.can_access_story(p_story_id) THEN
    RAISE EXCEPTION 'Access denied: story owner or participant required'
      USING ERRCODE = '42501';
  END IF;

  -- Try to find existing active PTT room for story
  SELECT vr.id, vr.livekit_room_name
  INTO v_room_id, v_room_livekit_name
  FROM voice_rooms vr
  WHERE vr.story_id = p_story_id
    AND vr.room_type = 'ptt'
    AND vr.is_active = true
  LIMIT 1;

  -- Create new room if none exists
  IF v_room_id IS NULL THEN
    IF NOT public.can_access_story(p_story_id, true) THEN
      RAISE EXCEPTION 'Access denied: creating a PTT channel requires write access to the story'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO voice_rooms (name, room_type, story_id, livekit_room_name, max_participants, created_by)
    VALUES (p_room_name, 'ptt', p_story_id, p_livekit_room_name, 20, v_user_id)
    RETURNING id, livekit_room_name INTO v_room_id, v_room_livekit_name;
  END IF;

  -- Upsert participant
  INSERT INTO call_participants (voice_room_id, user_id, role, is_muted, joined_at, left_at)
  VALUES (v_room_id, v_user_id, 'participant', true, now(), NULL)
  ON CONFLICT (voice_room_id, user_id) DO UPDATE SET
    is_muted = true,
    joined_at = now(),
    left_at = NULL;

  RETURN jsonb_build_object(
    'room_id', v_room_id,
    'room_name', v_room_livekit_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.join_ptt_channel(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_ptt_channel(text, text, uuid) TO authenticated;
