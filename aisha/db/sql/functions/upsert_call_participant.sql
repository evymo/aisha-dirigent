-- Function: public.upsert_call_participant
-- Records a participant join into a voice room (svc-livekit routes/token.ts,
-- after issuing the room access token). Idempotent on (voice_room_id, user_id):
-- a re-join refreshes joined_at/role and clears left_at.
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.upsert_call_participant(
  p_joined_at timestamptz,
  p_role text,
  p_user_id uuid,
  p_voice_room_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_voice_room_id IS NULL THEN
    RAISE EXCEPTION 'user_id and voice_room_id are required' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.call_participants (voice_room_id, user_id, joined_at, role)
  VALUES (p_voice_room_id, p_user_id, COALESCE(p_joined_at, now()), COALESCE(p_role, 'participant'))
  ON CONFLICT (voice_room_id, user_id) DO UPDATE
    SET joined_at = EXCLUDED.joined_at,
        role      = EXCLUDED.role,
        left_at   = NULL;
END;
$function$;

COMMENT ON FUNCTION public.upsert_call_participant(timestamptz, text, uuid, uuid) IS
  'Upserts a voice-room participant join (idempotent on voice_room_id + user_id).';

REVOKE ALL ON FUNCTION public.upsert_call_participant(timestamptz, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_call_participant(timestamptz, text, uuid, uuid) TO service_role;
