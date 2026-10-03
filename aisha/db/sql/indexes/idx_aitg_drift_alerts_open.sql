-- Index: idx_aitg_drift_alerts_open
-- Extracted from tables/aitg_drift_alerts.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_drift_alerts_open
  ON public.aitg_drift_alerts(test_id, severity, created_at DESC)
  WHERE resolved_at IS NULL;
