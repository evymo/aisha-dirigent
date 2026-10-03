-- Function: public.create_product_admin
-- Arguments: p_name, p_slug, p_description, p_short_description, p_price, p_compare_at_price,
--            p_images, p_category, p_in_stock, p_stock_quantity, p_is_active, p_image_url,
--            p_name_key, p_description_key, p_short_description_key, p_target_audience, p_use_case,
--            p_base_locale, p_badge_key, p_tagline_key, p_image_alt_key, p_benefits_title_key,
--            p_composition_title_key, p_usage_title_key, p_origin_content, p_benefits_content,
--            p_substances_content, p_usage_content
-- Description: Create a product with localization keys, images, and marketing content.
-- Security: SECURITY DEFINER, admin/staff only.
-- Updated: 2026-01-24 - Added marketing content columns

CREATE OR REPLACE FUNCTION public.create_product_admin(
  p_name text,
  p_slug text,
  p_description text DEFAULT NULL,
  p_short_description text DEFAULT NULL,
  p_price numeric DEFAULT 0,
  p_compare_at_price numeric DEFAULT NULL,
  p_images jsonb DEFAULT '[]'::jsonb,
  p_category text DEFAULT NULL,
  p_in_stock boolean DEFAULT true,
  p_stock_quantity integer DEFAULT 0,
  p_doses_per_package integer DEFAULT 30,
  p_is_active boolean DEFAULT true,
  p_image_url text DEFAULT NULL,
  p_name_key text DEFAULT NULL,
  p_description_key text DEFAULT NULL,
  p_short_description_key text DEFAULT NULL,
  p_target_audience text DEFAULT NULL,
  p_use_case text DEFAULT NULL,
  -- Translation metadata
  p_base_locale text DEFAULT 'en'::text,
  -- Marketing content translation keys
  p_badge_key text DEFAULT NULL,
  p_tagline_key text DEFAULT NULL,
  p_image_alt_key text DEFAULT NULL,
  p_benefits_title_key text DEFAULT NULL,
  p_composition_title_key text DEFAULT NULL,
  p_usage_title_key text DEFAULT NULL,
  p_origin_content jsonb DEFAULT NULL,
  p_benefits_content jsonb DEFAULT NULL,
  p_substances_content jsonb DEFAULT NULL,
  p_usage_content jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_name_key text;
  v_description_key text;
  v_short_description_key text;
  v_base_locale text;
  v_badge_key text;
  v_tagline_key text;
  v_image_alt_key text;
  v_benefits_title_key text;
  v_composition_title_key text;
  v_usage_title_key text;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  v_name_key := COALESCE(p_name_key, 'products.' || p_slug || '.name');
  v_description_key := COALESCE(p_description_key, 'products.' || p_slug || '.description');
  v_short_description_key := COALESCE(p_short_description_key, 'products.' || p_slug || '.short_description');
  v_base_locale := COALESCE(p_base_locale, 'en');
  v_badge_key := COALESCE(p_badge_key, 'products.' || p_slug || '.badge');
  v_tagline_key := COALESCE(p_tagline_key, 'products.' || p_slug || '.tagline');
  v_image_alt_key := COALESCE(p_image_alt_key, 'products.' || p_slug || '.image_alt');
  v_benefits_title_key := COALESCE(p_benefits_title_key, 'products.' || p_slug || '.benefits_title');
  v_composition_title_key := COALESCE(p_composition_title_key, 'products.' || p_slug || '.composition_title');
  v_usage_title_key := COALESCE(p_usage_title_key, 'products.' || p_slug || '.usage_title');

  INSERT INTO public.products (
    name,
    slug,
    description,
    short_description,
    price,
    compare_at_price,
    images,
    category,
    in_stock,
    stock_quantity,
    doses_per_package,
    is_active,
    image_url,
    name_key,
    description_key,
    short_description_key,
    target_audience,
    use_case,
    -- Translation metadata
    base_locale,
    -- Marketing content translation keys
    badge_key,
    tagline_key,
    image_alt_key,
    benefits_title_key,
    composition_title_key,
    usage_title_key,
    origin_content,
    benefits_content,
    substances_content,
    usage_content
  )
  VALUES (
    p_name,
    p_slug,
    p_description,
    p_short_description,
    p_price,
    p_compare_at_price,
    COALESCE((SELECT array_agg(elem::text) FROM jsonb_array_elements_text(p_images) AS elem), ARRAY[]::text[]),
    p_category,
    p_in_stock,
    p_stock_quantity,
    p_doses_per_package,
    p_is_active,
    p_image_url,
    v_name_key,
    v_description_key,
    v_short_description_key,
    p_target_audience,
    p_use_case,
    -- Translation metadata
    v_base_locale,
    -- Marketing content keys
    v_badge_key,
    v_tagline_key,
    v_image_alt_key,
    v_benefits_title_key,
    v_composition_title_key,
    v_usage_title_key,
    p_origin_content,
    p_benefits_content,
    p_substances_content,
    p_usage_content
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'shop'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_id::text,
      p_entity_type := 'product',
      p_new_values := jsonb_build_object('slug', p_slug, 'price', p_price),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Created product: ' || p_name,
      p_tags := ARRAY['admin', 'shop', 'product', 'create'],
      p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$;

-- Permissions (29 args: text x 18, numeric x 2, jsonb x 5, boolean x 2, integer x 2)
REVOKE ALL ON FUNCTION public.create_product_admin(
  text, text, text, text, numeric, numeric, jsonb, text, boolean, integer,
  integer, boolean, text, text, text, text, text, text, text,
  text, text, text, text, text, text,
  jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_product_admin(
  text, text, text, text, numeric, numeric, jsonb, text, boolean, integer,
  integer, boolean, text, text, text, text, text, text, text,
  text, text, text, text, text, text,
  jsonb, jsonb, jsonb, jsonb
) TO authenticated;
