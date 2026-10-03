-- Function: public.get_products_for_checkout
-- Arguments: p_product_ids uuid[]
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:24+01:00

CREATE OR REPLACE FUNCTION public.get_products_for_checkout(p_product_ids uuid[])
 RETURNS TABLE(id uuid, name text, slug text, price numeric, stripe_product_id text, stripe_price_id text, in_stock boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.slug,
    p.price,
    p.stripe_product_id,
    p.stripe_price_id,
    p.in_stock
  FROM products p
  WHERE p.id = ANY(p_product_ids)
  ORDER BY p.slug;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_products_for_checkout(p_product_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_products_for_checkout(p_product_ids uuid[]) TO authenticated;
