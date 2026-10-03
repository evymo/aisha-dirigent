-- Table: member_products
-- Community shared product definitions
-- RLS: ENABLED
-- Created: 2026-01-17

CREATE TABLE IF NOT EXISTS public.member_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  category text DEFAULT 'product', -- 'product', 'medication', 'herb', 'other'
  default_dose_amount numeric,
  default_dose_unit text DEFAULT 'mg',
  default_doses_per_day int DEFAULT 1,
  default_dose_timing text[] DEFAULT ARRAY['morning'],
  package_size numeric,
  package_unit text,
  is_public boolean DEFAULT false,
  usage_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.member_products ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE public.member_products IS 'Community shared product definitions that users can add to their plans';
COMMENT ON COLUMN public.member_products.created_by IS 'User who created this product definition';
COMMENT ON COLUMN public.member_products.name IS 'Name of the product';
COMMENT ON COLUMN public.member_products.description IS 'Description or notes about the product';
COMMENT ON COLUMN public.member_products.category IS 'Category: product, medication, herb, other';
COMMENT ON COLUMN public.member_products.default_dose_amount IS 'Default dose amount';
COMMENT ON COLUMN public.member_products.default_dose_unit IS 'Unit for dosing (mg, ml, drops, etc.)';
COMMENT ON COLUMN public.member_products.default_doses_per_day IS 'How many times per day';
COMMENT ON COLUMN public.member_products.default_dose_timing IS 'Default timing array (morning, noon, evening, night)';
COMMENT ON COLUMN public.member_products.package_size IS 'Size of a typical package';
COMMENT ON COLUMN public.member_products.package_unit IS 'Unit for package size';
COMMENT ON COLUMN public.member_products.is_public IS 'Whether visible to other users';
COMMENT ON COLUMN public.member_products.usage_count IS 'How many plans reference this product';
