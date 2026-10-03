-- Function: public.enforce_rate_limit
-- Arguments: p_endpoint_key text, p_window_ms integer, p_max_requests integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:28+01:00

CREATE OR REPLACE FUNCTION public.enforce_rate_limit(p_endpoint_key text, p_window_ms integer DEFAULT 60000, p_max_requests integer DEFAULT 60)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_current_count INTEGER;
  v_window_end TIMESTAMPTZ;
  v_existing_id UUID;
  v_user_exists BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Verify user exists in aisha_auth.users before any INSERT to prevent FK violation
  SELECT EXISTS(SELECT 1 FROM aisha_auth.users WHERE id = v_user_id) INTO v_user_exists;
  IF NOT v_user_exists THEN
    RETURN;
  END IF;

  v_window_end := now() + (p_window_ms || ' milliseconds')::INTERVAL;

  -- Check for existing active window
  SELECT id, request_count INTO v_existing_id, v_current_count
  FROM api_rate_limits
  WHERE user_id = v_user_id 
    AND endpoint_key = p_endpoint_key 
    AND window_end > now()
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Increment existing
    UPDATE api_rate_limits 
    SET request_count = request_count + 1
    WHERE id = v_existing_id;
    v_current_count := v_current_count + 1;
  ELSE
    -- Clean up expired and insert fresh
    DELETE FROM api_rate_limits 
    WHERE user_id = v_user_id AND endpoint_key = p_endpoint_key;
    
    INSERT INTO api_rate_limits (user_id, endpoint_key, request_count, window_start, window_end)
    VALUES (v_user_id, p_endpoint_key, 1, now(), v_window_end);
    v_current_count := 1;
  END IF;

  IF v_current_count > p_max_requests THEN
    RAISE EXCEPTION 'Rate limit exceeded for %. Max % requests per % ms.', p_endpoint_key, p_max_requests, p_window_ms;
  END IF;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.enforce_rate_limit(p_endpoint_key text, p_window_ms integer, p_max_requests integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_rate_limit(p_endpoint_key text, p_window_ms integer, p_max_requests integer) TO authenticated;
