-- =============================================================================
-- get_story_ptt_room
-- =============================================================================
-- Get active PTT voice room for a story.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_story_ptt_room(
  p_story_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  name text,
  livekit_room_name text,
  is_active boolean,
  max_participants integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;
  -- ⛔ Audit vydání 2026-10-01 (B2): jméno PTT místnosti v LiveKitu cizí story
  -- dostal každý přihlášený — a jméno je to, co si svc-livekit řekne o token.
  IF NOT public.can_access_story(p_story_id) THEN
    RAISE EXCEPTION 'Access denied: story owner or participant required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT vr.id, vr.name, vr.livekit_room_name, vr.is_active, vr.max_participants
  FROM voice_rooms vr
  WHERE vr.story_id = p_story_id
    AND vr.room_type = 'ptt'
    AND vr.is_active = true
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_story_ptt_room(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_story_ptt_room(uuid) TO authenticated;
