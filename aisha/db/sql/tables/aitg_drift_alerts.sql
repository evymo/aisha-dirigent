-- ============================================================================
-- Table: aitg_drift_alerts
-- Purpose: Time-series regression signal. The drift-detection RPC compares
--          pass-rate over two adjacent windows; when the delta crosses a
--          threshold (e.g. -10pp WoW), a row lands here. Rows stay until
--          either acknowledged (operator triage) or resolved (subsequent
--          runs return to baseline).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aitg_drift_alerts (
  alert_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id          text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  window_label     text NOT NULL,           -- '24h', '7d', etc.
  current_pass_rate  numeric NOT NULL CHECK (current_pass_rate BETWEEN 0 AND 1),
  previous_pass_rate numeric NOT NULL CHECK (previous_pass_rate BETWEEN 0 AND 1),
  delta            numeric NOT NULL,        -- current - previous
  severity         aitg_severity NOT NULL,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES aisha_auth.users(id),
  resolved_at      timestamptz,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aitg_drift_alerts ENABLE ROW LEVEL SECURITY;
