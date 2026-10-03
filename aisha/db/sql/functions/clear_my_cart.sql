-- Function: public.clear_my_cart
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:00+01:00

CREATE OR REPLACE FUNCTION public.clear_my_cart()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  DELETE FROM cart_items WHERE user_id = auth.uid();

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.clear_my_cart() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_my_cart() TO authenticated;
