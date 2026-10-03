-- Function: upsert_featured_product_admin
-- Description: Create or update featured product (admin only)
-- Security: SECURITY DEFINER with admin check + audit
-- Created: 2026-02-03

CREATE OR REPLACE FUNCTION upsert_featured_product_admin(
  p_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_badge_key text DEFAULT NULL,
  p_title_key text DEFAULT NULL,
  p_subtitle_key text DEFAULT NULL,
  p_feature_keys text[] DEFAULT NULL,
  p_cta_text_key text DEFAULT NULL,
  p_cta_url text DEFAULT NULL,
  p_price_period_days int4 DEFAULT NULL,
  p_show_price bool DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_background_gradient text DEFAULT NULL,
  p_display_location text DEFAULT NULL,
  p_sort_order int4 DEFAULT NULL,
  p_is_active bool DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_result_id uuid;
  v_is_insert bool := false;
BEGIN
  -- Authorization check
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'staff')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  -- Validate product exists
  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  IF p_id IS NULL THEN
    -- INSERT new
    v_is_insert := true;
    INSERT INTO featured_products (
      product_id,
      badge_key,
      title_key,
      subtitle_key,
      feature_keys,
      cta_text_key,
      cta_url,
      price_period_days,
      show_price,
      image_url,
      background_gradient,
      display_location,
      sort_order,
      is_active
    ) VALUES (
      COALESCE(p_product_id, (SELECT id FROM products WHERE is_active LIMIT 1)),
      COALESCE(p_badge_key, 'featured.default.badge'),
      COALESCE(p_title_key, 'featured.default.title'),
      p_subtitle_key,
      COALESCE(p_feature_keys, ARRAY[]::text[]),
      COALESCE(p_cta_text_key, 'featured.default.cta'),
      p_cta_url,
      COALESCE(p_price_period_days, 30),
      COALESCE(p_show_price, true),
      p_image_url,
      COALESCE(p_background_gradient, 'from-primary/5 via-primary/10 to-secondary/10'),
      COALESCE(p_display_location, 'homepage'),
      COALESCE(p_sort_order, 0),
      COALESCE(p_is_active, true)
    )
    RETURNING id INTO v_result_id;
  ELSE
    -- UPDATE existing
    UPDATE featured_products SET
      product_id = COALESCE(p_product_id, product_id),
      badge_key = COALESCE(p_badge_key, badge_key),
      title_key = COALESCE(p_title_key, title_key),
      subtitle_key = COALESCE(p_subtitle_key, subtitle_key),
      feature_keys = COALESCE(p_feature_keys, feature_keys),
      cta_text_key = COALESCE(p_cta_text_key, cta_text_key),
      cta_url = COALESCE(p_cta_url, cta_url),
      price_period_days = COALESCE(p_price_period_days, price_period_days),
      show_price = COALESCE(p_show_price, show_price),
      image_url = COALESCE(p_image_url, image_url),
      background_gradient = COALESCE(p_background_gradient, background_gradient),
      display_location = COALESCE(p_display_location, display_location),
      sort_order = COALESCE(p_sort_order, sort_order),
      is_active = COALESCE(p_is_active, is_active),
      updated_at = NOW()
    WHERE id = p_id
    RETURNING id INTO v_result_id;

    IF v_result_id IS NULL THEN
      RAISE EXCEPTION 'Featured product not found: %', p_id;
    END IF;
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    CASE WHEN v_is_insert THEN 'ADMIN_CREATE' ELSE 'ADMIN_UPDATE' END,
    jsonb_build_object(
      'area', 'featured_products',
      'entity_id', v_result_id,
      'severity', 'info'
    )
  );

  RETURN v_result_id;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION upsert_featured_product_admin(uuid, uuid, text, text, text, text[][], text, text, integer, boolean, text, text, text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_featured_product_admin(uuid, uuid, text, text, text, text[][], text, text, integer, boolean, text, text, text, integer, boolean) TO authenticated;

COMMENT ON FUNCTION upsert_featured_product_admin(uuid, uuid, text, text, text, text[][], text, text, integer, boolean, text, text, text, integer, boolean) IS 'Create or update featured product configuration (admin only)';
