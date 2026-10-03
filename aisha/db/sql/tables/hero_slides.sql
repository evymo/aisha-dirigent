-- Table: hero_slides
-- RLS: ENABLED
-- Description: Hero carousel slides for homepage marketing
-- Created: 2026-01-11

CREATE TABLE IF NOT EXISTS hero_slides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  base_locale text NOT NULL DEFAULT 'en'::text,
  title_key text NOT NULL,
  subtitle_key text,
  badge_key text,
  target_audience text DEFAULT 'all',
  background_image_url text,
  background_gradient text,
  cta_text_key text,
  cta_url text DEFAULT '/shop',
  linked_product_id uuid,
  sort_order int4 DEFAULT 0,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  circle_icon_key text,
  circle_text_key text,
  PRIMARY KEY (id),
  CONSTRAINT hero_slides_linked_product_id_fkey FOREIGN KEY (linked_product_id) REFERENCES products(id)
);

ALTER TABLE hero_slides ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE hero_slides IS 'Hero carousel slides for homepage marketing';
COMMENT ON COLUMN hero_slides.base_locale IS 'Base locale for translation fallback (e.g., "en")';
COMMENT ON COLUMN hero_slides.title_key IS 'Translation key for slide title (namespace: hero)';
COMMENT ON COLUMN hero_slides.subtitle_key IS 'Translation key for slide subtitle/description';
COMMENT ON COLUMN hero_slides.badge_key IS 'Translation key for slide badge text (e.g., "New", "Sale")';
COMMENT ON COLUMN hero_slides.target_audience IS 'Target audience: all, kids, athletes, midlife, seniors';
COMMENT ON COLUMN hero_slides.background_image_url IS 'URL to background image from hero-images storage bucket';
COMMENT ON COLUMN hero_slides.background_gradient IS 'CSS gradient for background overlay';
COMMENT ON COLUMN hero_slides.cta_text_key IS 'Translation key for call-to-action button text';
COMMENT ON COLUMN hero_slides.cta_url IS 'URL for the CTA button (default: /shop)';
COMMENT ON COLUMN hero_slides.linked_product_id IS 'Optional linked product for direct "Add to Cart" functionality';
COMMENT ON COLUMN hero_slides.sort_order IS 'Display order (lower = first)';
COMMENT ON COLUMN hero_slides.is_active IS 'Whether the slide is currently active';
COMMENT ON COLUMN hero_slides.circle_icon_key IS 'Translation key for circle decoration icon name';
COMMENT ON COLUMN hero_slides.circle_text_key IS 'Translation key for short text inside the decorative circle';
