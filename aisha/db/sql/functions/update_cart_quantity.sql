-- Function: public.update_cart_quantity
-- Arguments: p_item_id uuid, p_quantity integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:15+01:00

CREATE OR REPLACE FUNCTION public.update_cart_quantity(p_item_id uuid, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_quantity <= 0 THEN
    DELETE FROM cart_items WHERE id = p_item_id AND user_id = auth.uid();
  ELSE
    UPDATE cart_items
    SET quantity = p_quantity, updated_at = now()
    WHERE id = p_item_id AND user_id = auth.uid();
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_cart_quantity(p_item_id uuid, p_quantity integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_cart_quantity(p_item_id uuid, p_quantity integer) TO authenticated;
