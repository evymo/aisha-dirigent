-- Table: product_catalog
-- Centralized product catalog managed by admin
-- Translations via translations table (namespace=product_catalog)
-- RLS: ENABLED
-- Created: 2026-02-07

CREATE TABLE IF NOT EXISTS public.product_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'product',
  icon text NOT NULL DEFAULT '💊',
  color text NOT NULL DEFAULT '#6366f1',
  default_dose_amount numeric DEFAULT NULL,
  default_dose_unit text DEFAULT NULL,
  default_doses_per_day integer DEFAULT NULL,
  default_dose_timing text[] DEFAULT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_catalog ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE public.product_catalog IS 'Centralized product catalog managed by admin. Translations via translations table (namespace=product_catalog).';
COMMENT ON COLUMN public.product_catalog.code IS 'Unique code identifier (e.g., vitamin-d3, omega-3)';
COMMENT ON COLUMN public.product_catalog.category IS 'Category (vitamin, mineral, fatty-acid, probiotic, etc.)';
COMMENT ON COLUMN public.product_catalog.icon IS 'Emoji icon for display';
COMMENT ON COLUMN public.product_catalog.color IS 'Color code for display';
COMMENT ON COLUMN public.product_catalog.default_dose_amount IS 'Default dose amount';
COMMENT ON COLUMN public.product_catalog.default_dose_unit IS 'Default dose unit (mg, IU, cps, etc.)';
COMMENT ON COLUMN public.product_catalog.default_doses_per_day IS 'Default number of doses per day';
COMMENT ON COLUMN public.product_catalog.default_dose_timing IS 'Default timing array (morning, evening, etc.)';
COMMENT ON COLUMN public.product_catalog.sort_order IS 'Display sort order';
COMMENT ON COLUMN public.product_catalog.is_active IS 'Whether this catalog entry is active';
