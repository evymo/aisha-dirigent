-- Function: public.get_public_product_by_slug
-- Arguments: p_slug text, p_locale text
-- Description: Public product detail with localized fields and marketing content.
-- Security: SECURITY DEFINER (anon access).

CREATE OR REPLACE FUNCTION public.get_public_product_by_slug(p_slug text, p_locale text DEFAULT 'en')
RETURNS TABLE(
  archive_document_id uuid,
  base_locale text,
  badge text,
  benefits_content jsonb,
  benefits_title text,
  category text,
  compare_at_price numeric(10,2),
  composition_title text,
  created_at timestamptz,
  description text,
  id uuid,
  image_alt text,
  image_url text,
  images text[],
  in_stock boolean,
  membership_tier_required text,
  name text,
  origin_content jsonb,
  original_price double precision,
  price numeric(10,2),
  requires_membership boolean,
  short_description text,
  slug text,
  stock_quantity integer,
  substances_content jsonb,
  tagline text,
  target_audience text,
  updated_at timestamptz,
  usage_content jsonb,
  usage_title text,
  use_case text,
  -- Default protocol info for longevity display
  default_protocol jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(p.archive_document_id::text, '') as archive_document_id,
    COALESCE(p.base_locale, 'en') as base_locale,
    -- Badge (translation key)
    COALESCE(
      public.get_translation_value_with_fallback(
        p.badge_key,
        'products',
        p_locale,
        COALESCE(p.base_locale, 'en'),
        NULL
      ),
      ''
    ) as badge,
    -- Benefits content (JSONB with locale keys or translation keys)
    CASE
      WHEN p.benefits_content IS NULL THEN NULL::jsonb
      WHEN jsonb_typeof(p.benefits_content) <> 'object' THEN p.benefits_content
      WHEN p.benefits_content ? p_locale THEN p.benefits_content -> p_locale
      WHEN p.benefits_content ? 'en' THEN p.benefits_content -> 'en'
      ELSE p.benefits_content
    END as benefits_content,
    -- Benefits title (translation key)
    COALESCE(
      public.get_translation_value_with_fallback(
        p.benefits_title_key,
        'products',
        p_locale,
        COALESCE(p.base_locale, 'en'),
        NULL
      ),
      ''
    ) as benefits_title,
    COALESCE(p.category, '') as category,
    COALESCE(p.compare_at_price::float8, 0) as compare_at_price,
    -- Composition title (translation key)
    COALESCE(
      public.get_translation_value_with_fallback(
        p.composition_title_key,
        'products',
        p_locale,
        COALESCE(p.base_locale, 'en'),
        NULL
      ),
      ''
    ) as composition_title,
    p.created_at,
    COALESCE(
      public.get_translation_value_with_fallback(
        p.description_key,
        'products',
        p_locale,
        COALESCE(p.base_locale, 'en'),
        NULL
      ),
      COALESCE(p.description, '')
    ) as description,
    p.id,
    -- Image alt (translation key)
    COALESCE(
      public.get_translation_value_with_fallback(
        p.image_alt_key,
        'products',
        p_locale,
        COALESCE(p.base_locale, 'en'),
        NULL
      ),
      ''
    ) as image_alt,
    COALESCE(p.image_url, '') as image_url,
    COALESCE(p.images, ARRAY[]::text[]) as images,
    COALESCE(p.in_stock, true) as in_stock,
    '' as membership_tier_required,
    COALESCE(
      public.get_translation_value_with_fallback(
        p.name_key,
        'products',
        p_locale,
        COALESCE(p.base_locale, 'en'),
        NULL
      ),
      p.name
    ) as name,
    -- Origin content (JSONB with locale keys or translation keys)
    CASE
      WHEN p.origin_content IS NULL THEN NULL::jsonb
      WHEN jsonb_typeof(p.origin_content) <> 'object' THEN p.origin_content
      WHEN p.origin_content ? p_locale THEN p.origin_content -> p_locale
      WHEN p.origin_content ? 'en' THEN p.origin_content -> 'en'
      ELSE p.origin_content
    END as origin_content,
    COALESCE(p.compare_at_price::float8, 0) as original_price,
    p.price::float8 as price,
    false as requires_membership,
    COALESCE(
      public.get_translation_value_with_fallback(
        p.short_description_key,
        'products',
        p_locale,
        COALESCE(p.base_locale, 'en'),
        NULL
      ),
      COALESCE(p.short_description, '')
    ) as short_description,
    p.slug,
    COALESCE(p.stock_quantity, 0) as stock_quantity,
    -- Substances content (JSONB with locale keys or translation keys)
    CASE
      WHEN p.substances_content IS NULL THEN NULL::jsonb
      WHEN jsonb_typeof(p.substances_content) <> 'object' THEN p.substances_content
      WHEN p.substances_content ? p_locale THEN p.substances_content -> p_locale
      WHEN p.substances_content ? 'en' THEN p.substances_content -> 'en'
      ELSE p.substances_content
    END as substances_content,
    -- Tagline (translation key)
    COALESCE(
      public.get_translation_value_with_fallback(
        p.tagline_key,
        'products',
        p_locale,
        COALESCE(p.base_locale, 'en'),
        NULL
      ),
      ''
    ) as tagline,
    p.target_audience,
    p.updated_at,
    -- Usage content (JSONB with locale keys or translation keys)
    CASE
      WHEN p.usage_content IS NULL THEN NULL::jsonb
      WHEN jsonb_typeof(p.usage_content) <> 'object' THEN p.usage_content
      WHEN p.usage_content ? p_locale THEN p.usage_content -> p_locale
      WHEN p.usage_content ? 'en' THEN p.usage_content -> 'en'
      ELSE p.usage_content
    END as usage_content,
    -- Usage title (translation key)
    COALESCE(
      public.get_translation_value_with_fallback(
        p.usage_title_key,
        'products',
        p_locale,
        COALESCE(p.base_locale, 'en'),
        NULL
      ),
      ''
    ) as usage_title,
    p.use_case,
    -- Default protocol (if set)
    CASE 
      WHEN dp.id IS NOT NULL THEN jsonb_build_object(
        'id', dp.id,
        'name', COALESCE(
          (SELECT t.value FROM translations t 
           WHERE t.key = dp.name_key AND t.locale = p_locale AND t.namespace = 'distribution_protocols'),
          (SELECT t.value FROM translations t 
           WHERE t.key = dp.name_key AND t.locale = 'en' AND t.namespace = 'distribution_protocols'),
          dp.name
        ),
        'description', COALESCE(
          (SELECT t.value FROM translations t 
           WHERE t.key = dp.description_key AND t.locale = p_locale AND t.namespace = 'distribution_protocols'),
          (SELECT t.value FROM translations t 
           WHERE t.key = dp.description_key AND t.locale = 'en' AND t.namespace = 'distribution_protocols'),
          dp.description
        ),
        'dose_amount', dp.dose_amount,
        'dose_unit', dp.dose_unit,
        'doses_per_day', dp.doses_per_day,
        'dose_timing', dp.dose_timing
      )
      ELSE NULL::jsonb
    END as default_protocol
  FROM public.products p
  LEFT JOIN public.distribution_protocols dp ON dp.id = p.default_protocol_id AND dp.is_active = true
  WHERE p.slug = p_slug
    AND p.is_active = true;
END;
$function$;

-- Permissions (PUBLIC: product detail is public)
REVOKE ALL ON FUNCTION public.get_public_product_by_slug(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_product_by_slug(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_product_by_slug(text, text) TO authenticated;
