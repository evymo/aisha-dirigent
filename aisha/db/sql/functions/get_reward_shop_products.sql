-- get_reward_shop_products: Get active reward shop products with token price
-- Returns products available for purchase with PLATFORM tokens
CREATE OR REPLACE FUNCTION public.get_reward_shop_products()
RETURNS TABLE (
  category text,
  description text,
  id uuid,
  image_url text,
  name text,
  price numeric,
  sku text,
  token_price integer,
  token_price_type text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    p.category,
    p.description,
    p.id,
    p.image_url,
    p.name,
    p.price,
    p.sku,
    p.token_price,
    p.token_price_type
  FROM public.products p
  WHERE p.token_price IS NOT NULL
    AND p.token_price > 0
    AND p.is_active = true
  ORDER BY p.token_price ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_reward_shop_products() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reward_shop_products() TO authenticated;
