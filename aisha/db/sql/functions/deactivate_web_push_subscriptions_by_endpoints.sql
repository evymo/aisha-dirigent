-- Function: public.deactivate_web_push_subscriptions_by_endpoints
-- Arguments: p_endpoints text[], p_reason text
-- Description: Internal helper to disable invalid browser push endpoints.
-- Security: SECURITY DEFINER. Intended for service_role callers only.

CREATE OR REPLACE FUNCTION public.deactivate_web_push_subscriptions_by_endpoints(
  p_endpoints text[],
  p_reason text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_endpoints IS NULL OR array_length(p_endpoints, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.web_push_subscriptions
  SET
    is_active = false,
    last_error_at = now(),
    last_error_reason = COALESCE(NULLIF(trim(p_reason), ''), 'remote_endpoint_invalid'),
    updated_at = now()
  WHERE endpoint = ANY(p_endpoints)
    AND is_active = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.deactivate_web_push_subscriptions_by_endpoints(text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_web_push_subscriptions_by_endpoints(text[], text) TO service_role;
