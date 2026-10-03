-- =============================================================================
-- Table: branding_hostname_mapping — inbound hostname → published brand
-- =============================================================================
--
-- Maps the request's hostname (case-insensitive) to a published
-- `branding_profiles` row plus optional default-landing route hints.
--
-- Consumed at SPA bootstrap via the public RPC `get_branding_for_hostname`.
-- The SPA must pick its theme + first-paint landing route before login, so
-- this read path is intentionally anon-readable.
--
-- Multi-brand semantics: when a tenant runs more than one published
-- platform-level brand (partner_id IS NULL) on a single instance, this
-- table is what disambiguates them per request. Tenants that only use
-- per-partner branding can ignore this table entirely.

CREATE TABLE IF NOT EXISTS public.branding_hostname_mapping (
  -- Primary key is the hostname; the RPC LOWERs both sides for matching.
  hostname              text PRIMARY KEY,

  -- The brand to apply. ON DELETE RESTRICT to prevent orphaning a hostname
  -- by deleting its mapped brand without first removing the mapping row.
  branding_profile_id   uuid NOT NULL
                          REFERENCES public.branding_profiles(id)
                          ON UPDATE CASCADE ON DELETE RESTRICT,

  -- Tenant-defined slug categorising the brand (e.g. "umbrella",
  -- "therapy-first", "b2b", "b2c"). Informational only — routing reads
  -- `primary_route` / `secondary_route`, not `brand_variant`.
  brand_variant         text NOT NULL
                          CHECK (brand_variant ~ '^[a-z][a-z0-9_-]*$'),

  -- Default landing path for this hostname. SPA navigates to this after
  -- a "/" request (e.g. brandA.example.com → "/longevity"). NULL =
  -- render the platform's default homepage (no redirect).
  primary_route         text,

  -- Alternate route the brand exposes (e.g. an "also-available-at" link
  -- in the umbrella nav). Currently informational; UI can surface it as
  -- a brand-switch affordance.
  secondary_route       text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- RLS is enabled here; the permissive SELECT policy lives in
-- aisha/db/sql/policies/branding_hostname_mapping_anon_read.sql
-- (architectural convention: tables contain CREATE TABLE + ALTER ... ENABLE
-- RLS + GRANTs only; CREATE POLICY / CREATE INDEX live in their own dirs).
ALTER TABLE public.branding_hostname_mapping ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.branding_hostname_mapping IS
  'Inbound hostname → published branding_profiles row (+ default landing route '
  'hints). Consumed at SPA bootstrap via get_branding_for_hostname(). Hostname '
  'is the primary key — case-insensitive match is enforced by the RPC.';

COMMENT ON COLUMN public.branding_hostname_mapping.brand_variant IS
  'Tenant-defined slug categorising the brand variant (e.g. "umbrella", '
  '"therapy-first", "b2b", "b2c"). Informational; routing reads primary_route.';

GRANT SELECT ON public.branding_hostname_mapping TO anon, authenticated, service_role;
