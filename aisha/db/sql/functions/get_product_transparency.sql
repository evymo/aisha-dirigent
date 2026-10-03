-- Function: public.get_product_transparency
-- Description: Returns product transparency info including active batches,
--   related knowledge topics, and variant data. Non-sensitive data, public-safe.
-- Security: SECURITY DEFINER - public product transparency access.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_product_transparency(p_product_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_batches jsonb;
  v_topics jsonb;
  v_variants jsonb;
BEGIN
  -- Get product base info
  SELECT
    p.id,
    p.name,
    p.slug,
    p.description,
    p.short_description,
    p.category,
    p.origin_content,
    p.substances_content,
    p.benefits_content,
    p.usage_content,
    p.volume_ml,
    p.doses_per_package,
    p.image_url
  INTO v_product
  FROM products p
  WHERE p.slug = p_product_slug
    AND p.is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Product not found');
  END IF;

  -- Get released production batches (non-sensitive data, public transparency data)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'batch_code', pb.batch_code,
      'batch_number', pb.batch_number,
      'status', pb.status,
      'production_date', pb.production_date,
      'expiry_date', pb.expiry_date,
      'quality_approved', pb.quality_approved,
      'raw_material_lot', pb.raw_material_lot,
      'supplier_info', pb.supplier_info,
      'blockchain_tx_hash', pb.blockchain_tx_hash,
      'blockchain_recorded_at', pb.blockchain_recorded_at,
      'unit', pb.unit,
      'total_units', pb.total_units,
      'available_units', pb.available_units
    ) ORDER BY pb.production_date DESC NULLS LAST
  ), '[]'::jsonb) INTO v_batches
  FROM production_batches pb
  WHERE pb.product_id = v_product.id
    AND pb.status IN ('released', 'completed');

  -- Get related knowledge topics (via knowledge_topic_links)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'topic_id', kt.id,
      'slug', kt.slug,
      'title_key', kt.title_key,
      'verification_status', kt.verification_status,
      'link_type', ktl.link_type,
      'is_verified', ktl.is_verified
    ) ORDER BY ktl.sort_order
  ), '[]'::jsonb) INTO v_topics
  FROM knowledge_topic_links ktl
  JOIN knowledge_topics kt ON kt.id = ktl.topic_id
  WHERE ktl.product_id = v_product.id
    AND kt.visibility IN ('public', 'members');

  -- Get production variants for this product line
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'variant_code', pv.variant_code,
      'variant_name', pv.variant_name,
      'description', pv.description,
      'is_default', pv.is_default
    ) ORDER BY pv.sort_order
  ), '[]'::jsonb) INTO v_variants
  FROM production_variants pv
  WHERE LOWER(pv.product) = LOWER(
    CASE
      WHEN v_product.slug LIKE 'retisin%' THEN 'Retisin'
      WHEN v_product.slug LIKE 'floristen%' THEN 'Floristen'
      WHEN v_product.slug LIKE 'lyastin%' THEN 'Lyastin'
      ELSE v_product.name
    END
  )
  AND pv.is_active = true;

  RETURN jsonb_build_object(
    'product', jsonb_build_object(
      'id', v_product.id,
      'name', v_product.name,
      'slug', v_product.slug,
      'description', v_product.description,
      'short_description', v_product.short_description,
      'category', v_product.category,
      'origin_content', v_product.origin_content,
      'substances_content', v_product.substances_content,
      'benefits_content', v_product.benefits_content,
      'usage_content', v_product.usage_content,
      'volume_ml', v_product.volume_ml,
      'doses_per_package', v_product.doses_per_package,
      'image_url', v_product.image_url
    ),
    'batches', v_batches,
    'knowledge_topics', v_topics,
    'variants', v_variants
  );
END;
$function$;

-- Permissions: public transparency data
REVOKE ALL ON FUNCTION public.get_product_transparency(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_transparency(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_product_transparency(text) TO authenticated;
