-- Index: idx_integration_events_installation
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_integration_events_installation
  ON public.integration_events (installation_id, created_at) WHERE installation_id IS NOT NULL;
