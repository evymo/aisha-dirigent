-- Function: public.delete_web_push_subscription
-- Arguments: p_endpoint text
-- Description: Deactivate a browser push subscription for authenticated user.
-- Security: SECURITY DEFINER (uses auth.uid()).

CREATE OR REPLACE FUNCTION public.delete_web_push_subscription(
  p_endpoint text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_count integer;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.web_push_subscriptions
  SET
    is_active = false,
    updated_at = now()
  WHERE user_id = v_user_id
    AND (p_endpoint IS NULL OR endpoint = p_endpoint)
    AND is_active = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_web_push_subscription(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_web_push_subscription(text) TO authenticated;
