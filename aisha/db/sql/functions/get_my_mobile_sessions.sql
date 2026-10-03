-- Function: public.get_my_mobile_sessions
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:59+01:00

CREATE OR REPLACE FUNCTION public.get_my_mobile_sessions()
 RETURNS TABLE(id uuid, device_id text, device_platform text, device_model text, app_version text, last_active_at timestamptz, has_fcm_token boolean, has_apns_token boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ms.id,
    ms.device_id,
    ms.device_platform,
    ms.device_model,
    ms.app_version,
    ms.last_active_at,
    ms.fcm_token IS NOT NULL as has_fcm_token,
    ms.apns_token IS NOT NULL as has_apns_token
  FROM mobile_sessions ms
  WHERE ms.user_id = auth.uid()
  ORDER BY ms.last_active_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_mobile_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_mobile_sessions() TO authenticated;
