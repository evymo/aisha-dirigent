-- Table: dose_units
-- Reference table for dose measurement units with localization
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.dose_units (
  code text PRIMARY KEY,
  name_key text NOT NULL,            -- Translation key: dosing.units.<code>
  abbreviation_key text NOT NULL,    -- Translation key: dosing.units.<code>_abbr
  category text NOT NULL DEFAULT 'volume',  -- volume, count, weight
  base_multiplier numeric DEFAULT 1, -- For unit conversion (1 drop = X ml)
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.dose_units ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.dose_units IS 'Reference table for dose measurement units with localization';
COMMENT ON COLUMN public.dose_units.code IS 'Unique code for the unit (e.g., drops, spray, tablet)';
COMMENT ON COLUMN public.dose_units.name_key IS 'i18n translation key for full name';
COMMENT ON COLUMN public.dose_units.abbreviation_key IS 'i18n translation key for abbreviation';
COMMENT ON COLUMN public.dose_units.category IS 'Unit category: volume, count, weight';
