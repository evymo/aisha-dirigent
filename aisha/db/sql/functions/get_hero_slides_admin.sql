-- Function: public.get_hero_slides_admin
-- Arguments: none
-- Description: Returns all hero slides for admin management with linked product names.
-- Security: SECURITY DEFINER with search_path set. Requires admin role.
-- Extracted: 2026-01-09
-- Updated: 2026-01-30 - Migrated to translation keys

DROP FUNCTION IF EXISTS public.get_hero_slides_admin();

CREATE OR REPLACE FUNCTION public.get_hero_slides_admin()
RETURNS TABLE (
  background_gradient text,
  background_image_url text,
  base_locale text,
  badge_key text,
  circle_icon_key text,
  circle_text_key text,
  created_at timestamptz,
  cta_text_key text,
  cta_url text,
  id uuid,
  is_active boolean,
  linked_product_id uuid,
  linked_product_name text,
  sort_order integer,
  subtitle_key text,
  target_audience text,
  title_key text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'hero_slide',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read hero slide',
      p_tags := ARRAY['admin', 'hero_slide'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    COALESCE(hs.background_gradient, '') AS background_gradient,
    COALESCE(hs.background_image_url, '') AS background_image_url,
    COALESCE(hs.base_locale, 'en') AS base_locale,
    COALESCE(hs.badge_key, 'hero.' || hs.id || '.badge') AS badge_key,
    COALESCE(hs.circle_icon_key, 'hero.' || hs.id || '.circle_icon') AS circle_icon_key,
    COALESCE(hs.circle_text_key, 'hero.' || hs.id || '.circle_text') AS circle_text_key,
    COALESCE(hs.created_at, now()) AS created_at,
    COALESCE(hs.cta_text_key, 'hero.' || hs.id || '.cta_text') AS cta_text_key,
    COALESCE(hs.cta_url, '') AS cta_url,
    hs.id,
    COALESCE(hs.is_active, true) AS is_active,
    hs.linked_product_id,
    COALESCE(p.name, '') AS linked_product_name,
    COALESCE(hs.sort_order, 0) AS sort_order,
    COALESCE(hs.subtitle_key, 'hero.' || hs.id || '.subtitle') AS subtitle_key,
    COALESCE(hs.target_audience, 'all') AS target_audience,
    COALESCE(hs.title_key, 'hero.' || hs.id || '.title') AS title_key,
    COALESCE(hs.updated_at, now()) AS updated_at
  FROM hero_slides hs
  LEFT JOIN products p ON p.id = hs.linked_product_id
  ORDER BY hs.sort_order ASC, hs.created_at DESC;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_hero_slides_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_hero_slides_admin() TO authenticated;
