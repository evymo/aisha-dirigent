-- Function: public.add_to_cart
-- Arguments: p_product_id uuid, p_quantity integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:50+01:00

CREATE OR REPLACE FUNCTION public.add_to_cart(p_product_id uuid, p_quantity integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Check if item already in cart
  SELECT id INTO v_existing_id
  FROM cart_items
  WHERE user_id = auth.uid() AND product_id = p_product_id;

  IF v_existing_id IS NOT NULL THEN
    -- Update quantity
    UPDATE cart_items
    SET quantity = quantity + p_quantity, updated_at = now()
    WHERE id = v_existing_id;
  ELSE
    -- Insert new item
    INSERT INTO cart_items (user_id, product_id, quantity)
    VALUES (auth.uid(), p_product_id, p_quantity);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.add_to_cart(p_product_id uuid, p_quantity integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_to_cart(p_product_id uuid, p_quantity integer) TO authenticated;
