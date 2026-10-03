-- Table: featured_products
-- Description: Featured product highlights for homepage (e.g., "Novinka" section)
-- Created: 2026-02-03

CREATE TABLE IF NOT EXISTS featured_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  
  -- Product reference
  product_id uuid NOT NULL,
  
  -- i18n keys (namespace: featured)
  badge_key text NOT NULL DEFAULT 'featured.default.badge',
  title_key text NOT NULL DEFAULT 'featured.default.title',
  subtitle_key text,
  
  -- Features list (array of i18n keys)
  feature_keys text[] DEFAULT ARRAY[]::text[],
  
  -- CTA
  cta_text_key text DEFAULT 'featured.default.cta',
  cta_url text,  -- NULL = auto-generate from product slug
  
  -- Pricing display
  price_period_days int4 DEFAULT 30,
  show_price bool DEFAULT true,
  
  -- Visual
  image_url text,  -- NULL = use placeholder icon
  background_gradient text DEFAULT 'from-primary/5 via-primary/10 to-secondary/10',
  
  -- Display control
  display_location text NOT NULL DEFAULT 'homepage',
  sort_order int4 DEFAULT 0,
  is_active bool DEFAULT true,
  
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  PRIMARY KEY (id),
  CONSTRAINT featured_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT featured_products_display_location_sort_key UNIQUE (display_location, sort_order)
);

ALTER TABLE featured_products ENABLE ROW LEVEL SECURITY;

-- Note: Indexes are in supabase/sql/indexes/featured_products_indexes.sql

-- Column documentation
COMMENT ON TABLE featured_products IS 'Featured product highlights for homepage marketing sections';
COMMENT ON COLUMN featured_products.product_id IS 'Reference to the featured product (price is fetched dynamically)';
COMMENT ON COLUMN featured_products.badge_key IS 'Translation key for badge (e.g., "Novinka", "New")';
COMMENT ON COLUMN featured_products.title_key IS 'Translation key for main headline';
COMMENT ON COLUMN featured_products.subtitle_key IS 'Translation key for subtitle/description';
COMMENT ON COLUMN featured_products.feature_keys IS 'Array of translation keys for feature bullet points';
COMMENT ON COLUMN featured_products.cta_text_key IS 'Translation key for CTA button text';
COMMENT ON COLUMN featured_products.cta_url IS 'Custom CTA URL (NULL = auto-generate /shop/{product_slug})';
COMMENT ON COLUMN featured_products.price_period_days IS 'Price display period (e.g., 30 for "/ 30 days")';
COMMENT ON COLUMN featured_products.show_price IS 'Whether to show price on the highlight';
COMMENT ON COLUMN featured_products.image_url IS 'Product image URL (NULL = show placeholder icon)';
COMMENT ON COLUMN featured_products.background_gradient IS 'Tailwind CSS gradient classes for section background';
COMMENT ON COLUMN featured_products.display_location IS 'Where to display: homepage, shop, etc.';
COMMENT ON COLUMN featured_products.sort_order IS 'Display order within location (lower = first)';
COMMENT ON COLUMN featured_products.is_active IS 'Whether this highlight is currently active';

-- Grants
GRANT SELECT ON featured_products TO anon;
GRANT SELECT ON featured_products TO authenticated;
