-- Migration: health_metrics table for baseline tracking
-- Purpose: Store time-series health metrics for comparison with registration baseline
-- Related: Registration wizard migration, baseline tracking feature

-- =============================================================================
-- 1. CREATE TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  study_registration_id UUID REFERENCES public.study_registrations(id) ON DELETE SET NULL,
  
  -- Timestamp of measurement
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Scale metrics (1-10)
  physical_state INTEGER CHECK (physical_state IS NULL OR physical_state BETWEEN 1 AND 10),
  mental_state INTEGER CHECK (mental_state IS NULL OR mental_state BETWEEN 1 AND 10),
  energy_level INTEGER CHECK (energy_level IS NULL OR energy_level BETWEEN 1 AND 10),
  stress_level INTEGER CHECK (stress_level IS NULL OR stress_level BETWEEN 1 AND 10),
  sleep_quality INTEGER CHECK (sleep_quality IS NULL OR sleep_quality BETWEEN 1 AND 10),
  
  -- Numeric metrics
  weight_kg NUMERIC(5,2) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 500),
  height_cm NUMERIC(5,1) CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 300),
  
  -- Pain metrics (for comparison with health_check_ins)
  pain_level INTEGER CHECK (pain_level IS NULL OR pain_level BETWEEN 0 AND 10),
  
  -- Source tracking
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('registration', 'check_in', 'wearable', 'manual', 'lab_result')),
  source_id UUID,  -- Reference to source record (health_check_in.id, etc.)
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comments
COMMENT ON TABLE public.health_metrics IS 'Time-series health metrics for baseline comparison';
COMMENT ON COLUMN public.health_metrics.source IS 'Origin of the metric: registration, check_in, wearable, manual, lab_result';
COMMENT ON COLUMN public.health_metrics.source_id IS 'Reference to the source record (e.g., health_check_in.id)';

-- =============================================================================
-- 2. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. GRANTS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE ON public.health_metrics TO authenticated;

-- Note: RLS Policies are in supabase/sql/policies/health_metrics__*.sql
-- Note: Indexes are in supabase/sql/indexes/idx_health_metrics_*.sql
-- Note: Triggers are in supabase/sql/triggers/set_health_metrics_updated_at.sql
