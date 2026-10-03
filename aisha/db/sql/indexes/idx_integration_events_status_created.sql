-- Index: idx_integration_events_status_created
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_integration_events_status_created
  ON public.integration_events (status, created_at)
  WHERE status IN ('failed', 'received', 'processing');
