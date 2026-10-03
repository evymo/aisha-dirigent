-- Index: idx_integration_events_retry
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_integration_events_retry
  ON public.integration_events (next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;
