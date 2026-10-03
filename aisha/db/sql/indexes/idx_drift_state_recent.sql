-- Index: idx_drift_state_recent
-- Source: aisha/db/migrations/20260428101000_drift_state_phase1.sql

CREATE INDEX IF NOT EXISTS idx_drift_state_recent
  ON public.drift_state (observed_at DESC);
