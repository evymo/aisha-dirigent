-- Index: idx_drift_state_risk
-- Source: aisha/db/migrations/20260428101000_drift_state_phase1.sql

CREATE INDEX IF NOT EXISTS idx_drift_state_risk
  ON public.drift_state (risk_level, resolved_at)
  WHERE resolved_at IS NULL;
