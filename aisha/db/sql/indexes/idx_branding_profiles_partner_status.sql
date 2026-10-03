-- Index: idx_branding_profiles_partner_status
-- Fast branding profile lookups by partner + status
CREATE INDEX IF NOT EXISTS idx_branding_profiles_partner_status
  ON public.branding_profiles (partner_id, status);
