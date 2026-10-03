-- Table: plugin_tenant_overrides

CREATE TABLE IF NOT EXISTS public.plugin_tenant_overrides (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  config_override jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_tenant_overrides_plugin_id_tenant_id_key UNIQUE (plugin_id, tenant_id),
  CONSTRAINT plugin_tenant_overrides_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);

ALTER TABLE public.plugin_tenant_overrides ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.plugin_tenant_overrides IS 'Per-tenant plugin enable/disable and config overrides.';
