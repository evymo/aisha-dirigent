-- ============================================================================
-- Table: longevity_scores
-- Purpose: Stores longevity score assessments for users
-- Contains: sensitive data data - overall health longevity scores and domain breakdowns
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.longevity_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  overall_score NUMERIC(5,2) NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  domains JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.longevity_scores ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE public.longevity_scores IS 'Stores longevity score assessments. sensitive data - accessed via audited RPC only.';
COMMENT ON COLUMN public.longevity_scores.overall_score IS 'Overall longevity score (0-100)';
COMMENT ON COLUMN public.longevity_scores.domains IS 'Domain-specific scores (e.g., cardiovascular, metabolic, cognitive)';
COMMENT ON COLUMN public.longevity_scores.source IS 'Source of the assessment (manual, ai, wearable, etc.)';
