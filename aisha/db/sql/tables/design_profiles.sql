-- =============================================================================
-- Table: design_profiles — Occipitum design DNA per partner
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.design_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partner_profiles(id) ON DELETE CASCADE,
  brand_dna jsonb NOT NULL DEFAULT '{}'::jsonb,
  ux_persona jsonb NOT NULL DEFAULT '{}'::jsonb,
  style_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  design_constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.design_profiles IS
  'Occipitum design DNA: brand identity, UX persona, style preferences per partner.';

ALTER TABLE public.design_profiles ENABLE ROW LEVEL SECURITY;

-- Index: supabase/sql/indexes/idx_design_profiles_partner.sql
-- Policies: supabase/sql/policies/design_profiles_*.sql
-- Triggers: supabase/sql/triggers/update_design_profiles_updated_at.sql
