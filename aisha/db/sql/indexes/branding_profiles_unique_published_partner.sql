-- Index: branding_profiles_unique_published_partner
-- Table: branding_profiles
--
-- Per-partner branding invariant: at most one published branding profile per
-- partner_id. Platform-level brands (partner_id IS NULL) are unconstrained
-- and routed via branding_hostname_mapping — they are intentionally outside
-- the predicate so a tenant can publish N platform brands.
--
-- Replaces the pre-2026-05-24 EXCLUDE constraint
-- `branding_profiles_unique_published` which used a sentinel UUID for NULL
-- and therefore capped the platform at one published platform-level brand.

CREATE UNIQUE INDEX IF NOT EXISTS branding_profiles_unique_published_partner
  ON public.branding_profiles (partner_id)
  WHERE status = 'published' AND partner_id IS NOT NULL;
