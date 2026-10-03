-- Index: idx_integration_services_service_type
-- Table: integration_services

CREATE INDEX IF NOT EXISTS idx_integration_services_service_type
  ON public.integration_services (service_type);
