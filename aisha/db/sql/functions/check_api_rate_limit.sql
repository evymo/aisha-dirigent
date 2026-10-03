-- Function: public.check_api_rate_limit
-- Arguments: p_user_id uuid, p_endpoint text, p_window_ms integer, p_max_requests integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:56+01:00

CREATE OR REPLACE FUNCTION public.check_api_rate_limit(p_user_id uuid, p_endpoint text, p_window_ms integer, p_max_requests integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
  v_current_count INTEGER;
  v_allowed BOOLEAN;
  v_remaining INTEGER;
  v_reset_at TIMESTAMPTZ;
BEGIN
  -- Calculate window
  v_window_start := now();
  v_window_end := now() + (p_window_ms || ' milliseconds')::INTERVAL;
  v_reset_at := v_window_end;

  -- Get or create rate limit record
  INSERT INTO api_rate_limits (user_id, endpoint, window_start, window_end, request_count)
  VALUES (p_user_id, p_endpoint, v_window_start, v_window_end, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET
    request_count = api_rate_limits.request_count + 1,
    updated_at = now()
  RETURNING request_count INTO v_current_count;

  -- Clean up old records (older than window)
  DELETE FROM api_rate_limits
  WHERE window_end < now() - (p_window_ms || ' milliseconds')::INTERVAL;

  -- Check if allowed
  v_allowed := v_current_count <= p_max_requests;
  v_remaining := GREATEST(0, p_max_requests - v_current_count);

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'remaining', v_remaining,
    'limit', p_max_requests,
    'reset_at', v_reset_at,
    'current_count', v_current_count
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.check_api_rate_limit(p_user_id uuid, p_endpoint text, p_window_ms integer, p_max_requests integer) FROM PUBLIC;
-- No GRANT - internal/helper function
