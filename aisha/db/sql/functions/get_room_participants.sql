-- =============================================================================
-- get_room_participants
-- =============================================================================
-- Active participants in a voice room.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_room_participants(
  p_voice_room_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  voice_room_id uuid,
  user_id uuid,
  role text,
  is_muted boolean,
  joined_at timestamptz,
  left_at timestamptz
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
  -- ⛔ Audit vydání 2026-10-01 (B2): seznam účastníků KTERÉKOLI místnosti (i cizí
  -- konzultace) dostal každý přihlášený. Vidět, kdo je v místnosti, smí jen ten,
  -- kdo do ní smí vstoupit — týž predikát jako vydání tokenu v svc-livekit.
  IF NOT public.can_enter_voice_room(p_voice_room_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied: not allowed in this voice room'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT cp.id, cp.voice_room_id, cp.user_id, cp.role::text, cp.is_muted, cp.joined_at, cp.left_at
  FROM call_participants cp
  WHERE cp.voice_room_id = p_voice_room_id
    AND cp.left_at IS NULL
  ORDER BY cp.joined_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_room_participants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_participants(uuid) TO authenticated;
