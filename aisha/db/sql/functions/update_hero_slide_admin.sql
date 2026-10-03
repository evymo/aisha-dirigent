-- Function: public.update_hero_slide_admin
-- Arguments: p_id, p_base_locale, p_title_key, p_subtitle_key, p_badge_key, p_cta_text_key,
--            p_circle_icon_key, p_circle_text_key, p_target_audience, p_background_image_url,
--            p_background_gradient, p_cta_url, p_linked_product_id, p_is_active, p_sort_order
-- Description: Updates an existing hero slide. Requires admin role.
-- Security: SECURITY DEFINER with search_path set.
-- Extracted: 2026-01-09
-- Updated: 2026-01-30 - Migrated to translation keys

-- Drop old overloads (no longer exist, safe cleanup)
DROP FUNCTION IF EXISTS public.update_hero_slide_admin(uuid, text, text, text, text, text, text, text, text, text, text, text, uuid, boolean, integer);

CREATE OR REPLACE FUNCTION public.update_hero_slide_admin(
  p_id uuid,
  p_base_locale text DEFAULT NULL,
  p_title_key text DEFAULT NULL,
  p_subtitle_key text DEFAULT NULL,
  p_badge_key text DEFAULT NULL,
  p_cta_text_key text DEFAULT NULL,
  p_circle_icon_key text DEFAULT NULL,
  p_circle_text_key text DEFAULT NULL,
  p_target_audience text DEFAULT NULL,
  p_background_image_url text DEFAULT NULL,
  p_background_gradient text DEFAULT NULL,
  p_cta_url text DEFAULT NULL,
  p_linked_product_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_sort_order integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE hero_slides SET
    base_locale = COALESCE(p_base_locale, base_locale),
    title_key = COALESCE(p_title_key, title_key, 'hero.' || p_id || '.title'),
    subtitle_key = COALESCE(p_subtitle_key, subtitle_key, 'hero.' || p_id || '.subtitle'),
    badge_key = COALESCE(p_badge_key, badge_key, 'hero.' || p_id || '.badge'),
    cta_text_key = COALESCE(p_cta_text_key, cta_text_key, 'hero.' || p_id || '.cta_text'),
    circle_icon_key = COALESCE(p_circle_icon_key, circle_icon_key, 'hero.' || p_id || '.circle_icon'),
    circle_text_key = COALESCE(p_circle_text_key, circle_text_key, 'hero.' || p_id || '.circle_text'),
    target_audience = COALESCE(p_target_audience, target_audience),
    background_image_url = COALESCE(p_background_image_url, background_image_url),
    background_gradient = COALESCE(p_background_gradient, background_gradient),
    cta_url = COALESCE(p_cta_url, cta_url),
    linked_product_id = COALESCE(p_linked_product_id, linked_product_id),
    is_active = COALESCE(p_is_active, is_active),
    sort_order = COALESCE(p_sort_order, sort_order),
    updated_at = now()
  WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'content'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'hero_slide',
      p_new_values := jsonb_build_object('id', p_id),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Updated hero slide',
      p_tags := ARRAY['admin', 'hero_slide', 'update'],
      p_user_id := auth.uid()
  );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_hero_slide_admin(
  uuid, text, text, text, text, text, text, text,
  text, text, text, text, uuid, boolean, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_hero_slide_admin(
  uuid, text, text, text, text, text, text, text,
  text, text, text, text, uuid, boolean, integer
) TO authenticated;
