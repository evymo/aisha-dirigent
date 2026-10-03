-- Index: web_pages_slug_global_key
-- At most one global (brand-less) page per slug (branding_profile_id IS NULL).
-- Replaces the legacy single global UNIQUE(slug) constraint.

CREATE UNIQUE INDEX IF NOT EXISTS web_pages_slug_global_key
  ON public.web_pages (slug)
  WHERE branding_profile_id IS NULL;
