-- Function: public.get_active_web_push_subscriptions_for_users
-- Arguments: p_user_ids uuid[]
-- Description: Internal helper for service jobs to fetch active web push subscriptions.
-- Security: SECURITY DEFINER. Intended for service_role callers only.

CREATE OR REPLACE FUNCTION public.get_active_web_push_subscriptions_for_users(
  p_user_ids uuid[]
)
RETURNS TABLE (
  user_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  expiration_time timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.user_id,
    s.endpoint,
    s.p256dh,
    s.auth,
    s.expiration_time
  FROM public.web_push_subscriptions s
  WHERE s.user_id = ANY(p_user_ids)
    AND s.is_active = true
    AND (s.expiration_time IS NULL OR s.expiration_time > now())
  ORDER BY s.user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_active_web_push_subscriptions_for_users(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_web_push_subscriptions_for_users(uuid[]) TO service_role;
