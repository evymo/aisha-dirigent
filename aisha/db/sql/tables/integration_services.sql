-- ============================================================================
-- Source of Truth: integration_services
-- Popis: Registry externích integračních služeb (NocoDB, Langfuse, atd.)
--        Aisha Dirigent je využívá k autonomní správě admin prostředí.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.integration_services (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name  text NOT NULL UNIQUE,          -- 'nocodb', 'langfuse', 'n8n', ...
  display_name  text NOT NULL,                 -- 'NocoDB', 'Langfuse', ...
  service_type  text NOT NULL                  -- 'admin_bridge', 'observability', 'automation', 'monitoring'
                CHECK (service_type IN ('admin_bridge', 'observability', 'automation', 'analytics', 'messaging', 'monitoring', 'admin', 'scm')),
  base_url      text NOT NULL,                 -- 'https://nocodb.aisha.guru'
  api_token     text,                          -- encrypted API token (nullable for services using other auth)
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- service-specific config (schemas, project IDs, etc.)
  health_status text NOT NULL DEFAULT 'unknown'
                CHECK (health_status IN ('healthy', 'degraded', 'down', 'unknown')),
  last_health_check timestamptz,
  is_active     boolean NOT NULL DEFAULT true,
  managed_by    text NOT NULL DEFAULT 'aisha'  -- 'aisha', 'manual'
                CHECK (managed_by IN ('aisha', 'manual')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Komentáře
COMMENT ON TABLE public.integration_services IS 'Registry externích integračních služeb spravovaných Aishou';
COMMENT ON COLUMN public.integration_services.service_name IS 'Unikátní identifikátor služby (nocodb, langfuse, n8n)';
COMMENT ON COLUMN public.integration_services.config IS 'JSONB konfigurace specifická pro službu (ID projektů, schémata, atd.)';
COMMENT ON COLUMN public.integration_services.api_token IS 'API token pro autentizaci (pouze v DB, nikdy v logách!)';
COMMENT ON COLUMN public.integration_services.managed_by IS 'Kdo službu spravuje — aisha = autonomní, manual = ruční správa';

ALTER TABLE public.integration_services ENABLE ROW LEVEL SECURITY;
