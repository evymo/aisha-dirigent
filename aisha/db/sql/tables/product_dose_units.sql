-- Table: product_dose_units
-- Junction table defining allowed dose units per product
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.product_dose_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  dose_unit_code text NOT NULL REFERENCES public.dose_units(code) ON DELETE CASCADE,
  is_default boolean DEFAULT false,
  default_amount numeric DEFAULT 1,
  min_amount numeric DEFAULT 0.5,
  max_amount numeric DEFAULT 100,
  step_amount numeric DEFAULT 0.5,
  created_at timestamptz DEFAULT now(),
  UNIQUE(product_id, dose_unit_code)
);

ALTER TABLE public.product_dose_units ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.product_dose_units IS 'Junction table defining allowed dose units per product';
COMMENT ON COLUMN public.product_dose_units.is_default IS 'Whether this is the default unit for the product';
COMMENT ON COLUMN public.product_dose_units.default_amount IS 'Default dose amount when this unit is selected';
COMMENT ON COLUMN public.product_dose_units.min_amount IS 'Minimum allowed dose amount';
COMMENT ON COLUMN public.product_dose_units.max_amount IS 'Maximum allowed dose amount';
COMMENT ON COLUMN public.product_dose_units.step_amount IS 'Step increment for dose slider/input';
