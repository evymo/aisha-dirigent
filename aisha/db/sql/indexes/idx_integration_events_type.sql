-- Index: idx_integration_events_type
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_integration_events_type
  ON public.integration_events (event_type, created_at);
