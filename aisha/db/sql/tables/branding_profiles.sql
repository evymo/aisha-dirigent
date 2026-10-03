-- =============================================================================
-- Table: branding_profiles — Unified white-label design language per tenant
-- =============================================================================
-- Global fallback row: partner_id IS NULL.
-- Per-partner override: partner_id references partner_profiles.
-- Only ONE row per partner_id (or one global) can be status='published'.
-- Draft rows allow editing without immediate public impact.

CREATE TABLE IF NOT EXISTS public.branding_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = global/platform default; non-NULL = partner white-label override
  partner_id uuid REFERENCES public.partner_profiles(id) ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),

  -- ── Color Palette (HSL strings matching Tailwind CSS variable format) ──
  color_primary text NOT NULL DEFAULT '23 100% 55%',
  color_secondary text NOT NULL DEFAULT '210 16% 95%',
  color_accent text NOT NULL DEFAULT '22 100% 88%',
  color_background text NOT NULL DEFAULT '210 20% 98%',
  color_foreground text NOT NULL DEFAULT '0 0% 10%',
  color_muted text NOT NULL DEFAULT '220 9% 46%',
  color_surface text NOT NULL DEFAULT '0 0% 100%',
  color_destructive text NOT NULL DEFAULT '0 85% 66%',

  -- ── Dark mode overrides (NULL = auto-derived from light palette) ──
  dark_color_primary text,
  dark_color_background text,
  dark_color_foreground text,
  dark_color_surface text,
  dark_color_muted text,

  -- ── Typography ──
  font_family_brand text NOT NULL DEFAULT 'Nunito Sans, sans-serif',
  font_family_body text NOT NULL DEFAULT 'Nunito Sans, sans-serif',
  font_family_code text NOT NULL DEFAULT 'JetBrains Mono, monospace',

  -- Per-instance self-hosted @font-face definitions: jsonb array of
  -- {family, src_url, weight?, style?, unicode_range?}. NULL = OSS default
  -- (Nunito Sans ships statically in the repo). A private instance populates
  -- this to load its OWN licensed font (referenced by font_family_*) from its
  -- branding-assets host — the binary never enters the OSS repo. Rendered +
  -- sanitised at runtime by BrandingThemeProvider.buildFontFaceCss.
  font_faces jsonb,

  -- ── Brand Assets (storage paths in branding-assets bucket) ──
  logo_path text,
  logo_dark_path text,
  favicon_path text,
  login_logo_path text,

  -- ── Operator Identity ──
  operator_name text NOT NULL DEFAULT 'Platform',
  operator_email text NOT NULL DEFAULT 'support@platform.com',
  operator_phone text,
  operator_address text,
  operator_url text,

  -- ── Email Styling ──
  email_header_bg text,
  email_footer_text text,

  -- ── Keycloak / Login Theme ──
  login_background_color text,
  login_card_bg text,
  login_accent_color text,

  -- ── Metadata ──
  profile_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES aisha_auth.users(id),
  published_at timestamptz

  -- Per-partner: at most one published profile. Platform-level brands
  -- (partner_id IS NULL) are unconstrained — multi-brand-per-instance
  -- routes between them via `branding_hostname_mapping`. Enforced by the
  -- partial unique index `branding_profiles_unique_published_partner`
  -- below (not an EXCLUDE constraint, so that `partner_id IS NULL` rows
  -- are excluded from the uniqueness predicate without sentinel-UUID hacks).
);

COMMENT ON TABLE public.branding_profiles IS
  'Unified white-label design language. partner_id NULL = platform-level '
  'brand; multiple published platform brands per instance are allowed and '
  'routed by branding_hostname_mapping. partner_id NOT NULL = per-partner '
  'white-label override with at most one published profile per partner '
  '(enforced by aisha/db/sql/indexes/branding_profiles_unique_published_partner.sql '
  'partial unique index). Draft/publish workflow.';

ALTER TABLE public.branding_profiles ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON public.branding_profiles TO anon;
GRANT SELECT ON public.branding_profiles TO authenticated;
GRANT ALL ON public.branding_profiles TO service_role;
