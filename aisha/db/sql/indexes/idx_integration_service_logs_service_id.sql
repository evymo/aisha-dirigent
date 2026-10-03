-- Index: idx_integration_service_logs_service_id
-- Table: integration_service_logs

CREATE INDEX IF NOT EXISTS idx_integration_service_logs_service_id
  ON public.integration_service_logs (service_id);
