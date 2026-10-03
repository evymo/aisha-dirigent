-- =============================================================================
-- get_active_consultation_session
-- =============================================================================
-- Active/pending/ringing session for current user with room name.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_active_consultation_session()
RETURNS TABLE(
  id uuid,
  voice_room_id uuid,
  booking_id uuid,
  caller_id uuid,
  callee_id uuid,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  recording_consent boolean,
  recording_consent_at timestamptz,
  created_at timestamptz,
  livekit_room_name text
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

  RETURN QUERY
  SELECT
    cs.id,
    cs.voice_room_id,
    cs.booking_id,
    cs.caller_id,
    cs.callee_id,
    cs.status::text,
    cs.started_at,
    cs.ended_at,
    cs.duration_seconds,
    cs.recording_consent,
    cs.recording_consent_at,
    cs.created_at,
    vr.livekit_room_name
  FROM consultation_sessions cs
  JOIN voice_rooms vr ON cs.voice_room_id = vr.id
  WHERE (cs.caller_id = v_user_id OR cs.callee_id = v_user_id)
    AND cs.status IN ('pending', 'ringing', 'active')
  ORDER BY cs.created_at DESC
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_active_consultation_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_consultation_session() TO authenticated;
