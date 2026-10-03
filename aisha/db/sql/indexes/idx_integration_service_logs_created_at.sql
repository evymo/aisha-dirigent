-- Index: idx_integration_service_logs_created_at
-- Table: integration_service_logs

CREATE INDEX IF NOT EXISTS idx_integration_service_logs_created_at
  ON public.integration_service_logs (created_at DESC);
