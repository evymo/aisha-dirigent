-- Index: idx_web_pages_branding_profile
-- Lookup web pages by owning brand/site.

CREATE INDEX IF NOT EXISTS idx_web_pages_branding_profile
  ON public.web_pages (branding_profile_id);
