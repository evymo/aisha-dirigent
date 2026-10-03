-- Index: idx_drift_state_unresolved
-- Source: aisha/db/migrations/20260428101000_drift_state_phase1.sql

CREATE INDEX IF NOT EXISTS idx_drift_state_unresolved
  ON public.drift_state (app_uuid, drift_kind, observed_at)
  WHERE resolved_at IS NULL;
