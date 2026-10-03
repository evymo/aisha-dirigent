-- Function: get_featured_products
-- Description: Get active featured products with product details for public display
-- Security: SECURITY DEFINER for anon access
-- Created: 2026-02-03

CREATE OR REPLACE FUNCTION get_featured_products(
  p_location text DEFAULT 'homepage'
)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  product_name text,
  product_slug text,
  product_price numeric,
  badge_key text,
  title_key text,
  subtitle_key text,
  feature_keys text[],
  cta_text_key text,
  cta_url text,
  price_period_days int4,
  show_price bool,
  image_url text,
  background_gradient text,
  sort_order int4
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    fp.id,
    fp.product_id,
    p.name AS product_name,
    p.slug AS product_slug,
    p.price AS product_price,
    fp.badge_key,
    fp.title_key,
    fp.subtitle_key,
    fp.feature_keys,
    fp.cta_text_key,
    COALESCE(fp.cta_url, '/shop/' || p.slug) AS cta_url,
    fp.price_period_days,
    fp.show_price,
    COALESCE(fp.image_url, p.image_url) AS image_url,
    fp.background_gradient,
    fp.sort_order
  FROM featured_products fp
  JOIN products p ON p.id = fp.product_id
  WHERE fp.is_active = true
    AND fp.display_location = p_location
    AND p.is_active = true
  ORDER BY fp.sort_order ASC;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION get_featured_products(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_featured_products(text) TO anon;
GRANT EXECUTE ON FUNCTION get_featured_products(text) TO authenticated;

COMMENT ON FUNCTION get_featured_products(text) IS 'Get active featured products with joined product details for public display';
