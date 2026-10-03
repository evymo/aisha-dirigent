-- Function: fn_capture_personality_signal
-- Hippocampus: Capture a raw interaction signal for personality evolution.
-- Signals are aggregated periodically into experiential traits.

CREATE OR REPLACE FUNCTION public.fn_capture_personality_signal(
  p_user_id uuid,
  p_signal_type text,
  p_value jsonb DEFAULT '{}',
  p_weight real DEFAULT 0.5,
  p_conversation_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Auth check: require authenticated user or service_role
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- IDOR guard: bind the write to the caller unless service/admin.
  IF p_user_id IS NULL THEN
    p_user_id := auth.uid();
  END IF;
  IF p_user_id <> auth.uid() AND NOT public.is_service_role() AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF p_signal_type IS NULL OR p_signal_type = '' THEN
    RAISE EXCEPTION 'p_signal_type is required';
  END IF;

  INSERT INTO personality_signals (user_id, signal_type, value, weight, conversation_id)
  VALUES (p_user_id, p_signal_type, p_value, LEAST(1.0, GREATEST(0.0, p_weight)), p_conversation_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION fn_capture_personality_signal(uuid, text, jsonb, real, uuid) IS
  'Hippocampus: Capture a raw interaction signal for personality evolution. '
  'Signals are aggregated periodically into experiential traits.';

REVOKE ALL ON FUNCTION fn_capture_personality_signal(uuid, text, jsonb, real, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_capture_personality_signal(uuid, text, jsonb, real, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_capture_personality_signal(uuid, text, jsonb, real, uuid) TO service_role;
