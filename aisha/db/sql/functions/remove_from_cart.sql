-- Function: public.remove_from_cart
-- Arguments: p_item_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:00+01:00

CREATE OR REPLACE FUNCTION public.remove_from_cart(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  DELETE FROM cart_items WHERE id = p_item_id AND user_id = auth.uid();

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.remove_from_cart(p_item_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_from_cart(p_item_id uuid) TO authenticated;
