-- Function: public.get_my_rate_limit_status
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:04+01:00

CREATE OR REPLACE FUNCTION public.get_my_rate_limit_status()
 RETURNS TABLE(endpoint text, request_count integer, window_end timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    rl.endpoint,
    rl.request_count,
    rl.window_end
  FROM api_rate_limits rl
  WHERE rl.user_id = auth.uid()
    AND rl.window_end > now()
  ORDER BY rl.window_end DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_rate_limit_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_rate_limit_status() TO authenticated;
