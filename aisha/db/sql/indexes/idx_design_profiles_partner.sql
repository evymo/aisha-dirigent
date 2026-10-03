-- Index: idx_design_profiles_partner
-- Unique partner_id index on design_profiles

CREATE UNIQUE INDEX IF NOT EXISTS idx_design_profiles_partner
  ON public.design_profiles (partner_id);
