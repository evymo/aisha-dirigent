-- Function: public.get_public_hero_slides
-- Arguments: none
-- Description: Returns active hero slides for public display with linked product info.
-- Security: SECURITY DEFINER with search_path set. Public access.
-- Extracted: 2026-01-09
-- Updated: 2026-01-17 - Added circle_icon and circle_text fields

DROP FUNCTION IF EXISTS public.get_public_hero_slides();
DROP FUNCTION IF EXISTS public.get_public_hero_slides(text);

CREATE OR REPLACE FUNCTION public.get_public_hero_slides(p_locale text DEFAULT 'en')
RETURNS TABLE (
  background_gradient text,
  background_image_url text,
  badge text,
  circle_icon text,
  circle_text text,
  cta_text text,
  cta_url text,
  id uuid,
  linked_product_id uuid,
  linked_product_name text,
  linked_product_price numeric,
  linked_product_slug text,
  sort_order integer,
  subtitle text,
  target_audience text,
  title text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(hs.background_gradient, '') AS background_gradient,
    COALESCE(hs.background_image_url, '') AS background_image_url,
    COALESCE(
      public.get_translation_value_with_fallback(
        hs.badge_key,
        'hero',
        p_locale,
        COALESCE(hs.base_locale, 'en'),
        NULL
      ),
      ''
    ) AS badge,
    COALESCE(
      public.get_translation_value_with_fallback(
        hs.circle_icon_key,
        'hero',
        p_locale,
        COALESCE(hs.base_locale, 'en'),
        NULL
      ),
      'Sparkles'
    ) AS circle_icon,
    COALESCE(
      public.get_translation_value_with_fallback(
        hs.circle_text_key,
        'hero',
        p_locale,
        COALESCE(hs.base_locale, 'en'),
        NULL
      ),
      ''
    ) AS circle_text,
    COALESCE(
      public.get_translation_value_with_fallback(
        hs.cta_text_key,
        'hero',
        p_locale,
        COALESCE(hs.base_locale, 'en'),
        NULL
      ),
      ''
    ) AS cta_text,
    COALESCE(hs.cta_url, '') AS cta_url,
    hs.id,
    hs.linked_product_id,
    COALESCE(p.name, '') AS linked_product_name,
    COALESCE(p.price, 0) AS linked_product_price,
    COALESCE(p.slug, '') AS linked_product_slug,
    COALESCE(hs.sort_order, 0) AS sort_order,
    COALESCE(
      public.get_translation_value_with_fallback(
        hs.subtitle_key,
        'hero',
        p_locale,
        COALESCE(hs.base_locale, 'en'),
        NULL
      ),
      ''
    ) AS subtitle,
    COALESCE(hs.target_audience, 'all') AS target_audience,
    COALESCE(
      public.get_translation_value_with_fallback(
        hs.title_key,
        'hero',
        p_locale,
        COALESCE(hs.base_locale, 'en'),
        NULL
      ),
      ''
    ) AS title
  FROM hero_slides hs
  LEFT JOIN products p ON p.id = hs.linked_product_id
  WHERE hs.is_active = true
  ORDER BY hs.sort_order ASC, hs.created_at DESC;
END;
$$;

-- Permissions - public access for anonymous and authenticated users
REVOKE ALL ON FUNCTION public.get_public_hero_slides(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_hero_slides(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_hero_slides(text) TO authenticated;
