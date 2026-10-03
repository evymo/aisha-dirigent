-- Function: public.create_hero_slide_admin
-- Arguments: p_id, p_base_locale, p_title_key, p_subtitle_key, p_badge_key, p_cta_text_key,
--            p_circle_icon_key, p_circle_text_key, p_target_audience, p_background_image_url,
--            p_background_gradient, p_cta_url, p_linked_product_id, p_is_active, p_sort_order
-- Description: Creates a new hero slide. Requires admin role.
-- Security: SECURITY DEFINER with search_path set.
-- Extracted: 2026-01-09
-- Updated: 2026-01-30 - Migrated to translation keys

-- Drop old overloads (no longer exist, safe cleanup)
DROP FUNCTION IF EXISTS public.create_hero_slide_admin(uuid, text, text, text, text, text, text, text, text, text, text, text, uuid, boolean, integer);

CREATE OR REPLACE FUNCTION public.create_hero_slide_admin(
  p_id uuid DEFAULT NULL,
  p_base_locale text DEFAULT 'en',
  p_title_key text DEFAULT NULL,
  p_subtitle_key text DEFAULT NULL,
  p_badge_key text DEFAULT NULL,
  p_cta_text_key text DEFAULT NULL,
  p_circle_icon_key text DEFAULT NULL,
  p_circle_text_key text DEFAULT NULL,
  p_target_audience text DEFAULT 'all',
  p_background_image_url text DEFAULT NULL,
  p_background_gradient text DEFAULT NULL,
  p_cta_url text DEFAULT NULL,
  p_linked_product_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_sort_order integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_base_locale text;
  v_title_key text;
  v_subtitle_key text;
  v_badge_key text;
  v_cta_text_key text;
  v_circle_icon_key text;
  v_circle_text_key text;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_id := COALESCE(p_id, gen_random_uuid());
  v_base_locale := COALESCE(p_base_locale, 'en');
  v_title_key := COALESCE(p_title_key, 'hero.' || v_id || '.title');
  v_subtitle_key := COALESCE(p_subtitle_key, 'hero.' || v_id || '.subtitle');
  v_badge_key := COALESCE(p_badge_key, 'hero.' || v_id || '.badge');
  v_cta_text_key := COALESCE(p_cta_text_key, 'hero.' || v_id || '.cta_text');
  v_circle_icon_key := COALESCE(p_circle_icon_key, 'hero.' || v_id || '.circle_icon');
  v_circle_text_key := COALESCE(p_circle_text_key, 'hero.' || v_id || '.circle_text');

  INSERT INTO hero_slides (
    id,
    base_locale,
    title_key,
    subtitle_key,
    badge_key,
    cta_text_key,
    circle_icon_key,
    circle_text_key,
    target_audience,
    background_image_url, background_gradient,
    cta_url,
    linked_product_id, is_active, sort_order
  ) VALUES (
    v_id,
    v_base_locale,
    v_title_key,
    v_subtitle_key,
    v_badge_key,
    v_cta_text_key,
    v_circle_icon_key,
    v_circle_text_key,
    p_target_audience,
    p_background_image_url, p_background_gradient,
    p_cta_url,
    p_linked_product_id, p_is_active, p_sort_order
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_id::text,
      p_entity_type := 'hero_slide',
      p_new_values := jsonb_build_object('title_key', v_title_key, 'target_audience', p_target_audience),
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin created hero slide',
      p_tags := ARRAY['admin', 'content', 'hero_slide', 'create'],
      p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_hero_slide_admin(
  uuid, text, text, text, text, text, text, text,
  text, text, text, text, uuid, boolean, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_hero_slide_admin(
  uuid, text, text, text, text, text, text, text,
  text, text, text, text, uuid, boolean, integer
) TO authenticated;
