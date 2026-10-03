-- Function: public.get_my_cart
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:53+01:00

CREATE OR REPLACE FUNCTION public.get_my_cart()
 RETURNS TABLE(id uuid, product_id uuid, quantity integer, product_name text, product_price numeric, product_slug text, product_image_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT 
    ci.id,
    ci.product_id,
    ci.quantity,
    p.name as product_name,
    p.price as product_price,
    p.slug as product_slug,
    p.image_url as product_image_url
  FROM cart_items ci
  JOIN products p ON p.id = ci.product_id
  WHERE ci.user_id = auth.uid()
  ORDER BY ci.created_at;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_cart() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_cart() TO authenticated;
