-- Index: idx_integration_services_service_name
-- Table: integration_services

CREATE INDEX IF NOT EXISTS idx_integration_services_service_name
  ON public.integration_services (service_name);
