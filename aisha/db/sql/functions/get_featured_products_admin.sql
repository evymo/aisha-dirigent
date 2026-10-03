-- Function: get_featured_products_admin
-- Description: Get all featured products for admin management
-- Security: SECURITY DEFINER with admin check + audit
-- Created: 2026-02-03

CREATE OR REPLACE FUNCTION get_featured_products_admin()
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
  display_location text,
  sort_order int4,
  is_active bool,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  -- Authorization check
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'staff')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'ADMIN_VIEW',
    jsonb_build_object(
      'area', 'featured_products',
      'severity', 'info'
    )
  );

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
    fp.cta_url,
    fp.price_period_days,
    fp.show_price,
    fp.image_url,
    fp.background_gradient,
    fp.display_location,
    fp.sort_order,
    fp.is_active,
    fp.created_at,
    fp.updated_at
  FROM featured_products fp
  LEFT JOIN products p ON p.id = fp.product_id
  ORDER BY fp.display_location, fp.sort_order;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION get_featured_products_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_featured_products_admin() TO authenticated;

COMMENT ON FUNCTION get_featured_products_admin() IS 'Get all featured products for admin management with audit logging';
