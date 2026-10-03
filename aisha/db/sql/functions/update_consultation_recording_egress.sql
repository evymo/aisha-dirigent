-- Function: public.update_consultation_recording_egress
-- Tracks the LiveKit egress id on a consultation session when recording starts
-- (svc-livekit routes/recording.ts). The route has already verified session
-- membership + recording consent before calling this.
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.update_consultation_recording_egress(
  p_recording_egress_id text,
  p_session_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id is required' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.consultation_sessions
     SET recording_egress_id = p_recording_egress_id
   WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultation session not found: %', p_session_id USING ERRCODE = 'no_data_found';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.update_consultation_recording_egress(text, uuid) IS
  'Sets consultation_sessions.recording_egress_id when a LiveKit recording egress starts.';

REVOKE ALL ON FUNCTION public.update_consultation_recording_egress(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_consultation_recording_egress(text, uuid) TO service_role;
