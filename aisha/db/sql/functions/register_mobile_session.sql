-- Function: public.register_mobile_session
-- Arguments: p_device_id text, p_platform text, p_fcm_token text, p_device_name text, p_app_version text, p_os_version text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:00+01:00

CREATE OR REPLACE FUNCTION public.register_mobile_session(p_device_id text, p_platform text, p_fcm_token text DEFAULT NULL::text, p_device_name text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_os_version text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id UUID;
BEGIN
  INSERT INTO public.mobile_sessions (
    user_id, device_id, device_platform, fcm_token, device_model, app_version, device_os_version, last_active_at
  ) VALUES (
    auth.uid(), p_device_id, p_platform, p_fcm_token, p_device_name, p_app_version, p_os_version, now()
  )
  ON CONFLICT (user_id, device_id) DO UPDATE SET
    fcm_token = COALESCE(EXCLUDED.fcm_token, mobile_sessions.fcm_token),
    device_model = COALESCE(EXCLUDED.device_model, mobile_sessions.device_model),
    app_version = COALESCE(EXCLUDED.app_version, mobile_sessions.app_version),
    device_os_version = COALESCE(EXCLUDED.device_os_version, mobile_sessions.device_os_version),
    device_platform = EXCLUDED.device_platform,
    last_active_at = now(),
    updated_at = now()
  RETURNING id INTO v_session_id;
  
  RETURN v_session_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.register_mobile_session(p_device_id text, p_platform text, p_fcm_token text, p_device_name text, p_app_version text, p_os_version text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_mobile_session(p_device_id text, p_platform text, p_fcm_token text, p_device_name text, p_app_version text, p_os_version text) TO authenticated;
