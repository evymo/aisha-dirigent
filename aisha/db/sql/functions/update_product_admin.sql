-- Function: public.update_product_admin
-- Arguments: p_id, p_name, p_slug, p_description, p_short_description, p_price, p_compare_at_price,
--            p_images, p_category, p_in_stock, p_stock_quantity, p_is_active, p_image_url,
--            p_name_key, p_description_key, p_short_description_key, p_target_audience, p_use_case,
--            p_base_locale, p_badge_key, p_tagline_key, p_image_alt_key, p_benefits_title_key,
--            p_composition_title_key, p_usage_title_key, p_origin_content, p_benefits_content,
--            p_substances_content, p_usage_content, p_default_protocol_id
-- Description: Update a product with localization keys, images, and marketing content.
-- Security: SECURITY DEFINER, admin/staff only.
-- Updated: 2026-01-24 - Added marketing content columns and default_protocol_id

CREATE OR REPLACE FUNCTION public.update_product_admin(
  p_id uuid,
  p_name text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_short_description text DEFAULT NULL,
  p_price numeric DEFAULT NULL,
  p_compare_at_price numeric DEFAULT NULL,
  p_images jsonb DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_in_stock boolean DEFAULT NULL,
  p_stock_quantity integer DEFAULT NULL,
  p_doses_per_package integer DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_name_key text DEFAULT NULL,
  p_description_key text DEFAULT NULL,
  p_short_description_key text DEFAULT NULL,
  p_target_audience text DEFAULT NULL,
  p_use_case text DEFAULT NULL,
  -- Translation metadata
  p_base_locale text DEFAULT NULL,
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
  p_usage_content jsonb DEFAULT NULL,
  -- Default protocol for longevity display
  p_default_protocol_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  UPDATE public.products SET
    name = COALESCE(p_name, name),
    slug = COALESCE(p_slug, slug),
    description = COALESCE(p_description, description),
    short_description = COALESCE(p_short_description, short_description),
    price = COALESCE(p_price, price),
    compare_at_price = COALESCE(p_compare_at_price, compare_at_price),
    images = CASE
      WHEN p_images IS NOT NULL THEN COALESCE(
        (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(p_images) AS elem),
        ARRAY[]::text[]
      )
      ELSE images
    END,
    category = COALESCE(p_category, category),
    in_stock = COALESCE(p_in_stock, in_stock),
    stock_quantity = COALESCE(p_stock_quantity, stock_quantity),
    doses_per_package = COALESCE(p_doses_per_package, doses_per_package),
    is_active = COALESCE(p_is_active, is_active),
    image_url = COALESCE(p_image_url, image_url),
    name_key = COALESCE(p_name_key, name_key),
    description_key = COALESCE(p_description_key, description_key),
    short_description_key = COALESCE(p_short_description_key, short_description_key),
    target_audience = COALESCE(p_target_audience, target_audience),
    use_case = COALESCE(p_use_case, use_case),
    -- Translation metadata
    base_locale = COALESCE(p_base_locale, base_locale),
    -- Marketing content translation keys
    badge_key = COALESCE(p_badge_key, badge_key),
    tagline_key = COALESCE(p_tagline_key, tagline_key),
    image_alt_key = COALESCE(p_image_alt_key, image_alt_key),
    benefits_title_key = COALESCE(p_benefits_title_key, benefits_title_key),
    composition_title_key = COALESCE(p_composition_title_key, composition_title_key),
    usage_title_key = COALESCE(p_usage_title_key, usage_title_key),
    origin_content = COALESCE(p_origin_content, origin_content),
    benefits_content = COALESCE(p_benefits_content, benefits_content),
    substances_content = COALESCE(p_substances_content, substances_content),
    usage_content = COALESCE(p_usage_content, usage_content),
    default_protocol_id = COALESCE(p_default_protocol_id, default_protocol_id),
    updated_at = NOW()
  WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'shop'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'product',
      p_new_values := jsonb_build_object('name', p_name, 'slug', p_slug),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Updated product',
      p_tags := ARRAY['admin', 'shop', 'product', 'update'],
      p_user_id := auth.uid()
  );

  RETURN FOUND;
END;
$function$;

-- Permissions (30 args: uuid x 2, text x 18, numeric x 2, jsonb x 5, boolean x 2, integer x 1)
REVOKE ALL ON FUNCTION public.update_product_admin(
  uuid, text, text, text, text, numeric, numeric, jsonb, text, boolean, integer,
  integer, boolean, text, text, text, text, text, text, text,
  text, text, text, text, text, text,
  jsonb, jsonb, jsonb, jsonb, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_product_admin(
  uuid, text, text, text, text, numeric, numeric, jsonb, text, boolean, integer,
  integer, boolean, text, text, text, text, text, text, text,
  text, text, text, text, text, text,
  jsonb, jsonb, jsonb, jsonb, uuid
) TO authenticated;
