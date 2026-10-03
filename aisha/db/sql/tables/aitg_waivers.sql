-- ============================================================================
-- Table: aitg_waivers
-- Purpose: Time-bound risk acceptance for a specific AITG test. CHECK constraint
--          forces expires_at > now() at insert time and minimum 20-char
--          justification — prevents drive-by waivers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aitg_waivers (
  waiver_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id       text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  scope         jsonb NOT NULL,
  justification text NOT NULL CHECK (length(justification) >= 20),
  approved_by   uuid NOT NULL REFERENCES aisha_auth.users(id),
  expires_at    timestamptz NOT NULL CHECK (expires_at > now()),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aitg_waivers ENABLE ROW LEVEL SECURITY;
