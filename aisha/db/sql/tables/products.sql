-- Table: products
-- RLS: ENABLED
-- Updated: 2026-01-24 - Added marketing content columns

CREATE TABLE IF NOT EXISTS products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  short_description text,
  name_key text,
  description_key text,
  short_description_key text,
  price numeric(10,2) NOT NULL,
  compare_at_price numeric(10,2),
  image_url text,
  images text[],
  category text,
  sku text,
  in_stock bool DEFAULT true,
  stock_quantity int4 DEFAULT 0,
  requires_prescription bool DEFAULT false,
  requires_certification bool DEFAULT false,
  is_active bool DEFAULT true,
  is_public bool DEFAULT false,
  metadata jsonb,
  stripe_product_id text,
  stripe_price_id text,
  target_audience text DEFAULT 'all',
  min_age int4 DEFAULT 18,
  use_case text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  archive_document_id uuid,
  -- Translation metadata
  base_locale text NOT NULL DEFAULT 'en'::text,
  -- Marketing content translation keys
  badge_key text,
  tagline_key text,
  image_alt_key text,
  benefits_title_key text,
  composition_title_key text,
  usage_title_key text,
  -- Structured marketing content (JSONB with locale keys)
  origin_content jsonb,
  benefits_content jsonb,
  substances_content jsonb,
  usage_content jsonb,
  -- Default distribution protocol for longevity/public display
  default_protocol_id uuid,
  -- Product tracking: how many doses per package
  doses_per_package integer DEFAULT 30 NOT NULL,
  -- Distribution conversion helpers (for drops/sprays/ml conversions)
  volume_ml numeric(10,2) DEFAULT 30 NOT NULL,
  drops_per_ml numeric(10,2) DEFAULT 22 NOT NULL,
  -- Active substance concentration
  concentration_mg_ml numeric(10,2),
  -- Token-based reward shop pricing (added in tokenomics migration)
  token_price integer,
  token_price_type text DEFAULT 'aisha'::text,
  PRIMARY KEY (id),
  CONSTRAINT products_slug_key UNIQUE (slug),
  CONSTRAINT products_doses_per_package_positive CHECK (doses_per_package > 0),
  CONSTRAINT products_volume_ml_positive CHECK (volume_ml > 0),
  CONSTRAINT products_drops_per_ml_positive CHECK (drops_per_ml > 0),
  CONSTRAINT products_archive_document_id_fkey FOREIGN KEY (archive_document_id) REFERENCES archive_documents(id)
  -- Note: products_default_protocol_id_fkey is added after distribution_protocols table creation
  -- to avoid circular dependency (products ↔ distribution_protocols)
);

-- Index moved to: supabase/sql/indexes/products_sku_unique.sql

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Grants: public product catalog
GRANT SELECT ON products TO anon;
GRANT SELECT ON products TO authenticated;
GRANT ALL ON products TO service_role;

-- Column documentation
COMMENT ON COLUMN products.sku IS 'Stock Keeping Unit - unique product identifier';
COMMENT ON COLUMN products.requires_prescription IS 'Whether the product requires a medical prescription';
COMMENT ON COLUMN products.requires_certification IS 'Whether the product requires partner certification to purchase';
COMMENT ON COLUMN products.is_active IS 'Whether the product is currently active and visible';
COMMENT ON COLUMN products.is_public IS 'Whether the product is publicly visible (vs member-only)';
COMMENT ON COLUMN products.metadata IS 'Additional product metadata as JSON';
COMMENT ON COLUMN products.stripe_product_id IS 'Stripe product ID for payment integration';
COMMENT ON COLUMN products.stripe_price_id IS 'Stripe price ID for payment integration';
COMMENT ON COLUMN products.target_audience IS 'Target audience: all, kids, athletes, midlife, seniors';
COMMENT ON COLUMN products.min_age IS 'Minimum age requirement for purchase';
COMMENT ON COLUMN products.use_case IS 'Primary use case for the product';
COMMENT ON COLUMN products.doses_per_package IS 'Number of doses per package. For RTN 30ml bottles with typical 22 drops/ml dropper at 2x daily = ~30 doses per bottle.';
COMMENT ON COLUMN products.volume_ml IS 'Nominal bottle volume in ml used for distribution entitlement calculations.';
COMMENT ON COLUMN products.drops_per_ml IS 'Conversion factor for drops per ml used in distribution entitlement calculations.';
COMMENT ON COLUMN products.concentration_mg_ml IS 'Concentration of active substance in mg per ml';
