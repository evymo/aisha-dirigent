-- Index: idx_integration_service_logs_action
-- Table: integration_service_logs

CREATE INDEX IF NOT EXISTS idx_integration_service_logs_action
  ON public.integration_service_logs (action);
