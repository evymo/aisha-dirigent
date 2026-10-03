-- Index: web_pages_slug_brand_key
-- At most one page per slug within a given brand/site (branding_profile_id IS NOT NULL).

CREATE UNIQUE INDEX IF NOT EXISTS web_pages_slug_brand_key
  ON public.web_pages (branding_profile_id, slug)
  WHERE branding_profile_id IS NOT NULL;
