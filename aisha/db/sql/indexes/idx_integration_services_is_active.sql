-- Index: idx_integration_services_is_active
-- Table: integration_services

CREATE INDEX IF NOT EXISTS idx_integration_services_is_active
  ON public.integration_services (is_active)
  WHERE is_active = true;
