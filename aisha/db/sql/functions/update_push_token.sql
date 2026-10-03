-- Function: public.update_push_token
-- Arguments: p_device_id text, p_fcm_token text, p_apns_token text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:24+01:00

CREATE OR REPLACE FUNCTION public.update_push_token(p_device_id text, p_fcm_token text DEFAULT NULL::text, p_apns_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_updated INTEGER;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE mobile_sessions
  SET
    fcm_token = COALESCE(p_fcm_token, fcm_token),
    apns_token = COALESCE(p_apns_token, apns_token),
    last_active_at = now(),
    updated_at = now()
  WHERE user_id = v_user_id AND device_id = p_device_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Session not found for device_id: %', p_device_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_updated
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_push_token(p_device_id text, p_fcm_token text, p_apns_token text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_push_token(p_device_id text, p_fcm_token text, p_apns_token text) TO authenticated;
