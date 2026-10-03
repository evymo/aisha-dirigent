-- Function: public.get_my_web_push_subscriptions
-- Arguments: (none)
-- Description: List browser push subscriptions for authenticated user.
-- Security: SECURITY DEFINER (uses auth.uid()).

CREATE OR REPLACE FUNCTION public.get_my_web_push_subscriptions()
RETURNS TABLE (
  id uuid,
  endpoint text,
  is_active boolean,
  expiration_time timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  last_seen_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.endpoint,
    s.is_active,
    s.expiration_time,
    s.created_at,
    s.updated_at,
    s.last_seen_at
  FROM public.web_push_subscriptions s
  WHERE s.user_id = v_user_id
  ORDER BY s.updated_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_web_push_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_web_push_subscriptions() TO authenticated;
